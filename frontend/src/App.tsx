import { useState, useEffect, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

// =============================================================================
// Constants & Types
// =============================================================================

const AMENITIES = [
  { id: 'pub', emoji: '🍺', label: 'Pubs' },
  { id: 'cafe', emoji: '☕', label: 'Cafés' },
  { id: 'train', emoji: '🚂', label: 'Train stations' },
  { id: 'pool', emoji: '🏊', label: 'Swimming pools' },
  { id: 'gym', emoji: '💪', label: 'Gyms' },
  { id: 'park', emoji: '🌳', label: 'Parks' },
  { id: 'pizza', emoji: '🍕', label: 'Pizza' },
  { id: 'fastfood', emoji: '🍔', label: 'Fast food' },
  { id: 'fuel', emoji: '⛽', label: 'Petrol stations' },
  { id: 'pharmacy', emoji: '💊', label: 'Pharmacies' },
  { id: 'atm', emoji: '🏧', label: 'ATMs' },
  { id: 'supermarket', emoji: '🛒', label: 'Supermarkets' },
  { id: 'toilet', emoji: '🚻', label: 'Public toilets' },
  { id: 'parking', emoji: '🅿️', label: 'Parking' },
  { id: 'library', emoji: '📚', label: 'Libraries' },
  { id: 'cinema', emoji: '🎬', label: 'Cinemas' },
] as const

type AmenityId = typeof AMENITIES[number]['id']
type DistanceUnit = 'feet' | 'meters'

type AppView =
  | 'welcome'
  | 'loading'
  | 'location_error'
  | 'network_error'
  | 'rate_limited'
  | 'grid'
  | 'searching'
  | 'results'
  | 'no_results'
  | 'navigating'
  | 'recalculating'
  | 'arrived'
  | 'settings'
  | 'about'

const WELCOMED_KEY = 'mojinav_welcomed'

interface Location {
  lat: number
  lng: number
}

interface SearchResult {
  id: number
  lat: number
  lng: number
  tags: Record<string, string>
}

interface RouteStep {
  instruction: string
  type: number
  distance: number
  duration: number
  way_points: number[]
}

interface Route {
  distance: number
  duration: number
  coordinates: [number, number][]
  steps: RouteStep[]
}

// Maneuver type to arrow emoji mapping
const MANEUVER_ARROWS: Record<number, string> = {
  0: '⬅️',   // Left
  1: '➡️',   // Right
  2: '↗️',   // Slight right
  3: '↖️',   // Slight left
  4: '➡️',   // Sharp right
  5: '⬅️',   // Sharp left
  6: '⬆️',   // Straight
  7: '↩️',   // U-turn
  8: '↩️',   // U-turn
  9: '↩️',   // U-turn
  10: '🏁',  // Arrive
  11: '⬆️',  // Depart/Head
  12: '⬆️',  // Keep
  13: '⬆️',  // Keep
}

// Emoji number mapping
const DIGIT_EMOJIS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣']

// =============================================================================
// Utility Functions
// =============================================================================

function createEmojiIcon(emoji: string, size: number = 32): L.DivIcon {
  return L.divIcon({
    html: `<span style="font-size: ${size}px; line-height: 1;">${emoji}</span>`,
    className: 'emoji-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function formatDistance(meters: number, unit: DistanceUnit): string {
  let value: number
  let suffix: string

  if (unit === 'feet') {
    const feet = meters * 3.28084
    if (feet >= 1000) {
      // Convert to miles
      value = Math.round((feet / 5280) * 10) / 10
      suffix = '📏'
    } else {
      value = Math.round(feet)
      suffix = '🦶'
    }
  } else {
    if (meters >= 1000) {
      // Convert to km
      value = Math.round((meters / 1000) * 10) / 10
      suffix = '📏'
    } else {
      value = Math.round(meters)
      suffix = 'Ⓜ️'
    }
  }

  // Convert number to emoji digits
  const digits = value.toString().split('').map(char => {
    if (char === '.') return '.'
    return DIGIT_EMOJIS[parseInt(char)] || char
  }).join('')

  return digits + suffix
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Haversine formula for distance in meters
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// =============================================================================
// Map Components
// =============================================================================

function MapUpdater({ center, zoom }: { center: [number, number]; zoom?: number }) {
  const map = useMap()
  useEffect(() => {
    if (zoom) {
      map.setView(center, zoom)
    } else {
      map.setView(center)
    }
  }, [center, zoom, map])
  return null
}

function FitBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap()
  useEffect(() => {
    map.fitBounds(bounds, { padding: [50, 50] })
  }, [bounds, map])
  return null
}

// =============================================================================
// Main App
// =============================================================================

function App() {
  const [view, setView] = useState<AppView>(() =>
    localStorage.getItem(WELCOMED_KEY) === 'true' ? 'loading' : 'welcome'
  )
  const [location, setLocation] = useState<Location | null>(null)
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(() => {
    const saved = localStorage.getItem('mojinav_unit')
    return (saved === 'feet' || saved === 'meters') ? saved : 'feet'
  })
  const [selectedAmenity, setSelectedAmenity] = useState<AmenityId | null>(null)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [selectedDestination, setSelectedDestination] = useState<SearchResult | null>(null)
  const [route, setRoute] = useState<Route | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  // Compass heading from GPS (degrees, 0=N, clockwise). null = device not
  // reporting (typically when stationary). Drives the navigation map's
  // course-up rotation.
  const [heading, setHeading] = useState<number | null>(null)
  // Smoothed CSS bearing applied to the nav map: -heading, but normalized
  // to be within ±180° of the previous value so CSS transitions take the
  // shortest path (no 359°→1° backtracking).
  const [bearing, setBearing] = useState(0)

  const watchIdRef = useRef<number | null>(null)
  const lastRecalcTimeRef = useRef<number>(0)
  // Monotonic token used to ignore stale search/route responses after the
  // user hits back (or restarts a search) while a fetch is still in flight.
  const requestTokenRef = useRef(0)

  // Save distance unit to localStorage
  useEffect(() => {
    localStorage.setItem('mojinav_unit', distanceUnit)
    console.log(`📏 Distance unit set to: ${distanceUnit}`)
  }, [distanceUnit])

  // Translate raw heading into a smoothed bearing. We negate (so the user's
  // direction-of-travel ends up at the top of the screen) and unwrap to
  // ±180° of the prior value so a 359° → 1° tick rotates 2° forward, not
  // 358° backward.
  useEffect(() => {
    if (heading == null) return
    setBearing(prev => {
      let next = -heading
      while (next - prev > 180) next -= 360
      while (next - prev < -180) next += 360
      return next
    })
  }, [heading])

  // Initialize: check backend and get location
  const initialize = useCallback(async () => {
    console.log('🚀 MojiNav initializing...')

    try {
      const response = await fetch('/api/health')
      if (!response.ok) {
        console.error('❌ Backend unhealthy:', response.status)
        setView('network_error')
        return
      }
      console.log('✅ Backend healthy')
    } catch (error) {
      console.error('❌ Backend connection failed:', error)
      setView('network_error')
      return
    }

    if (!navigator.geolocation) {
      console.error('❌ Geolocation not supported')
      setView('location_error')
      return
    }

    console.log('📍 Requesting location permission...')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = { lat: position.coords.latitude, lng: position.coords.longitude }
        console.log('✅ Location acquired:', loc)
        setLocation(loc)
        setView('grid')
      },
      (error) => {
        console.error('❌ Location error:', error.message)
        setView('location_error')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }, [])

  useEffect(() => {
    // Auto-initialize for returning users; first-time users see the welcome
    // screen and trigger initialize via the "Use my location" button so the
    // browser permission prompt has visible cause-and-effect.
    if (localStorage.getItem(WELCOMED_KEY) === 'true') {
      initialize()
    }
  }, [initialize])

  const handleWelcomeContinue = useCallback(() => {
    localStorage.setItem(WELCOMED_KEY, 'true')
    setView('loading')
    initialize()
  }, [initialize])

  // Cleanup position watcher
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  // Search for amenities
  const handleAmenitySelect = useCallback(async (amenityId: AmenityId) => {
    if (!location) return

    console.log(`🔍 Searching for: ${amenityId}`)
    setSelectedAmenity(amenityId)
    setSearchResults([])
    setView('searching')

    const myToken = ++requestTokenRef.current

    try {
      const response = await fetch(
        `/api/search?lat=${location.lat}&lng=${location.lng}&amenity=${amenityId}`
      )

      if (myToken !== requestTokenRef.current) return

      if (response.status === 429) {
        console.warn('🐢 Rate limited')
        setView('rate_limited')
        return
      }

      if (!response.ok) {
        console.error('❌ Search failed:', response.status)
        setView('network_error')
        return
      }

      const data = await response.json()
      if (myToken !== requestTokenRef.current) return
      console.log(`📍 Found ${data.count} results`)

      if (data.count === 0) {
        setView('no_results')
        return
      }

      setSearchResults(data.results)
      setView('results')
    } catch (error) {
      if (myToken !== requestTokenRef.current) return
      console.error('❌ Search error:', error)
      setView('network_error')
    }
  }, [location])

  // Select a destination and get route
  const handleDestinationSelect = useCallback(async (result: SearchResult) => {
    if (!location) return

    console.log(`🎯 Selected destination: ${result.id}`)
    setSelectedDestination(result)
    setView('searching')

    const myToken = ++requestTokenRef.current

    try {
      const response = await fetch(
        `/api/route?start_lat=${location.lat}&start_lng=${location.lng}&end_lat=${result.lat}&end_lng=${result.lng}`
      )

      if (myToken !== requestTokenRef.current) return

      if (response.status === 429) {
        console.warn('🐢 Rate limited')
        setView('rate_limited')
        return
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        console.error('❌ Route failed:', response.status, data)
        setView('network_error')
        return
      }

      const routeData: Route = await response.json()
      if (myToken !== requestTokenRef.current) return
      console.log(`🧭 Route: ${routeData.distance}m, ${routeData.steps.length} steps`)

      setRoute(routeData)
      setCurrentStepIndex(0)
      setView('navigating')

      // Start watching position
      startPositionWatch(result, routeData)
    } catch (error) {
      if (myToken !== requestTokenRef.current) return
      console.error('❌ Route error:', error)
      setView('network_error')
    }
  }, [location])

  // Position watching for navigation
  const startPositionWatch = useCallback((destination: SearchResult, currentRoute: Route) => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const newLoc = { lat: position.coords.latitude, lng: position.coords.longitude }
        setLocation(newLoc)

        // Capture heading when the device reports one. GPS heading is null
        // when stationary on most devices; we just keep the previous value
        // in that case so the map doesn't flip back to north-up.
        if (typeof position.coords.heading === 'number' && !isNaN(position.coords.heading)) {
          setHeading(position.coords.heading)
        }

        // Check if arrived (within 20m of destination)
        const distToDest = calculateDistance(newLoc.lat, newLoc.lng, destination.lat, destination.lng)
        if (distToDest < 20) {
          console.log('🎉 Arrived at destination!')
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current)
            watchIdRef.current = null
          }
          setView('arrived')
          return
        }

        // Check for step progression (within 6m of step end)
        setCurrentStepIndex((prevIndex) => {
          const step = currentRoute.steps[prevIndex]
          if (step && step.way_points.length > 1) {
            const endIdx = step.way_points[step.way_points.length - 1]
            const endCoord = currentRoute.coordinates[endIdx]
            if (endCoord) {
              const distToStep = calculateDistance(newLoc.lat, newLoc.lng, endCoord[1], endCoord[0])
              if (distToStep < 6 && prevIndex < currentRoute.steps.length - 1) {
                console.log(`📍 Advancing to step ${prevIndex + 1}`)
                return prevIndex + 1
              }
            }
          }
          return prevIndex
        })

        // Check if off-route (simple distance from line - could be improved)
        const nearestDist = findNearestDistanceToRoute(newLoc, currentRoute.coordinates)
        if (nearestDist > 30) {
          const now = Date.now()
          if (now - lastRecalcTimeRef.current > 10000) {
            console.log('🔄 Off-route, recalculating...')
            lastRecalcTimeRef.current = now
            setView('recalculating')
            // Recalculate route
            recalculateRoute(newLoc, destination)
          }
        }
      },
      (error) => {
        console.warn('📍 Position error:', error.message)
        // Don't show error for intermittent failures
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    )
  }, [])

  const findNearestDistanceToRoute = (loc: Location, coords: [number, number][]): number => {
    let minDist = Infinity
    for (const coord of coords) {
      const dist = calculateDistance(loc.lat, loc.lng, coord[1], coord[0])
      if (dist < minDist) minDist = dist
    }
    return minDist
  }

  const recalculateRoute = async (currentLoc: Location, destination: SearchResult) => {
    try {
      const response = await fetch(
        `/api/route?start_lat=${currentLoc.lat}&start_lng=${currentLoc.lng}&end_lat=${destination.lat}&end_lng=${destination.lng}`
      )

      if (response.ok) {
        const routeData: Route = await response.json()
        console.log(`🧭 Route recalculated: ${routeData.distance}m`)
        setRoute(routeData)
        setCurrentStepIndex(0)
        setView('navigating')
      } else {
        console.error('❌ Recalculation failed')
        setView('navigating')
      }
    } catch (error) {
      console.error('❌ Recalculation error:', error)
      setView('navigating')
    }
  }

  // Go back to grid
  const goBack = useCallback(() => {
    // Invalidate any in-flight search/route fetch so a late response doesn't
    // hijack the UI back into 'results' / 'navigating'.
    requestTokenRef.current++
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
    setSearchResults([])
    setSelectedDestination(null)
    setRoute(null)
    setSelectedAmenity(null)
    setView('grid')
  }, [])

  // Retry location
  const retryLocation = useCallback(() => {
    setView('loading')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = { lat: position.coords.latitude, lng: position.coords.longitude }
        setLocation(loc)
        setView('grid')
      },
      () => setView('location_error'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }, [])

  // =============================================================================
  // Render Views
  // =============================================================================

  // Welcome / interstitial: shown on the very first visit so the browser's
  // location prompt has a visible cause (a button tap) instead of firing
  // the moment the page loads.
  if (view === 'welcome') {
    return (
      <div className="about-view">
        <div className="about-content welcome-content">
          <h1 className="about-title">Ⓜ️🍩🌶️📍♑️🔺✌️</h1>
          <p className="about-tagline">Emoji-only walking navigation 🚶</p>

          <section className="about-section">
            <p className="about-prose">
              Tap an emoji, see places nearby, follow the arrows.
            </p>
          </section>

          <section className="about-section">
            <h2>📍 Why location?</h2>
            <p className="about-prose">
              MojiNav needs your location to find places near you and walking
              routes to them. Your coordinates go to OpenStreetMap and
              OpenRouteService for those lookups, and stay out of MojiNav's
              own logs.
            </p>
          </section>

          <button className="welcome-cta" onClick={handleWelcomeContinue}>
            <span className="welcome-cta-emoji">📍</span>
          </button>
          <p className="welcome-cta-hint">Tap to share your location</p>
        </div>
      </div>
    )
  }

  // Loading
  if (view === 'loading') {
    return (
      <div className="app-container">
        <div className="loading-indicator">
          <span className="pulse">📍</span>
        </div>
      </div>
    )
  }

  // Location error
  if (view === 'location_error') {
    return (
      <div className="app-container">
        <div className="error-container">
          <span className="error-icon">📍🚫</span>
          <button className="retry-button" onClick={retryLocation}>🔄</button>
        </div>
      </div>
    )
  }

  // Network error
  if (view === 'network_error') {
    return (
      <div className="app-container">
        <div className="error-container">
          <span className="error-icon">🌐❌</span>
          <button className="retry-button" onClick={() => window.location.reload()}>🔄</button>
        </div>
      </div>
    )
  }

  // Rate limited
  if (view === 'rate_limited') {
    return (
      <div className="app-container">
        <div className="error-container">
          <span className="error-icon">🐢</span>
          <button className="retry-button" onClick={goBack}>⬅️</button>
        </div>
      </div>
    )
  }

  // Searching / recalculating: show the map (with whatever we already know
  // about location and destination) underneath a translucent chip with the
  // existing bouncer + spinner. Map appears immediately so the wait doesn't
  // feel like a hung app, even though the backend can take a few seconds
  // to do its progressive Overpass radius expansion.
  if (view === 'searching' || view === 'recalculating') {
    const amenity = AMENITIES.find(a => a.id === selectedAmenity)
    const chip = (
      <div className="searching-chip">
        <span className="searching-icon bounce">{amenity?.emoji || '🔍'}</span>
        <span className="searching-indicator spin">
          {view === 'recalculating' ? '🔄' : '🔍'}
        </span>
      </div>
    )

    if (location) {
      return (
        <div className="map-view">
          <button className="map-back-button" onClick={goBack}>⬅️</button>
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener noreferrer"
            className="copyright-button"
          >
            ©️
          </a>
          <MapContainer
            center={[location.lat, location.lng]}
            zoom={15}
            className="map-container"
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer
              url="https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png"
            />
            <Marker position={[location.lat, location.lng]} icon={createEmojiIcon('📍', 40)} />
            {selectedDestination && (
              <Marker
                position={[selectedDestination.lat, selectedDestination.lng]}
                icon={createEmojiIcon(amenity?.emoji || '🏁', 36)}
              />
            )}
          </MapContainer>
          {chip}
        </div>
      )
    }

    return (
      <div className="app-container">
        {chip}
      </div>
    )
  }

  // No results
  if (view === 'no_results') {
    return (
      <div className="app-container">
        <div className="error-container">
          <span className="error-icon">🔍❌</span>
          <button className="retry-button" onClick={goBack}>⬅️</button>
        </div>
      </div>
    )
  }

  // About / help
  if (view === 'about') {
    return (
      <div className="about-view">
        <button className="back-button" onClick={() => setView('grid')}>⬅️</button>
        <div className="about-content">
          <h1 className="about-title">Ⓜ️🍩🌶️📍♑️🔺✌️</h1>
          <p className="about-tagline">Emoji-only walking navigation 🚶</p>

          <section className="about-section">
            <h2>📋 How</h2>
            <ol className="about-howto">
              <li><span className="step-num">1️⃣</span> Tap an emoji</li>
              <li><span className="step-num">2️⃣</span> See places nearby</li>
              <li><span className="step-num">3️⃣</span> Tap one</li>
              <li><span className="step-num">4️⃣</span> Follow the arrows</li>
              <li><span className="step-num">5️⃣</span> 🎉</li>
            </ol>
          </section>

          <section className="about-section">
            <h2>🔍 What you can find</h2>
            <ul className="about-legend">
              {AMENITIES.map(a => (
                <li key={a.id}>
                  <span className="legend-emoji">{a.emoji}</span>
                  <span className="legend-label">{a.label}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="about-section">
            <h2>🧭 Arrows</h2>
            <ul className="about-legend">
              <li><span className="legend-emoji">⬆️</span><span className="legend-label">Straight</span></li>
              <li><span className="legend-emoji">➡️</span><span className="legend-label">Right</span></li>
              <li><span className="legend-emoji">⬅️</span><span className="legend-label">Left</span></li>
              <li><span className="legend-emoji">↗️</span><span className="legend-label">Slight right</span></li>
              <li><span className="legend-emoji">↖️</span><span className="legend-label">Slight left</span></li>
              <li><span className="legend-emoji">↩️</span><span className="legend-label">U-turn</span></li>
              <li><span className="legend-emoji">🏁</span><span className="legend-label">Arrived</span></li>
            </ul>
          </section>

          <section className="about-section">
            <h2>📏 Distance</h2>
            <p className="about-prose">
              Tap <span className="inline-emoji">⚙️</span> to switch between{' '}
              <span className="inline-emoji">🦶</span> feet/miles and{' '}
              <span className="inline-emoji">Ⓜ️</span> metres/km.
            </p>
          </section>

          <section className="about-section">
            <h2>⚠️ Errors</h2>
            <ul className="about-legend">
              <li><span className="legend-emoji">📍🚫</span><span className="legend-label">Location denied</span></li>
              <li><span className="legend-emoji">🌐❌</span><span className="legend-label">Network error</span></li>
              <li><span className="legend-emoji">🔍❌</span><span className="legend-label">No results</span></li>
              <li><span className="legend-emoji">🐢</span><span className="legend-label">Slow down</span></li>
              <li><span className="legend-emoji">⏱️</span><span className="legend-label">Timeout</span></li>
            </ul>
          </section>

          <section className="about-section">
            <h2>🔒 Privacy</h2>
            <p className="about-prose">
              Your coordinates go to OpenStreetMap and OpenRouteService —
              that's how MojiNav finds places and routes. They're kept
              out of MojiNav's own logs.
            </p>
          </section>

          <section className="about-section">
            <h2>🙏 Built on</h2>
            <ul className="about-attribution">
              <li>
                <span className="legend-emoji">🗺️</span>
                <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
                  OpenStreetMap
                </a>
                <span className="attr-note">place data</span>
              </li>
              <li>
                <span className="legend-emoji">🧭</span>
                <a href="https://openrouteservice.org/" target="_blank" rel="noopener noreferrer">
                  OpenRouteService
                </a>
                <span className="attr-note">routing</span>
              </li>
              <li>
                <span className="legend-emoji">🎨</span>
                <a href="https://stadiamaps.com/" target="_blank" rel="noopener noreferrer">
                  Stadia Maps
                </a>
                <span className="attr-note">map tiles</span>
              </li>
            </ul>
          </section>

          <section className="about-footer">
            <p className="about-prose">
              Walking only — not driving, not transit. 🚶
            </p>
            <p className="about-prose">
              Originally vibecoded for Chainguard's Vibelympics, December 2025.
            </p>
            <p className="about-source">
              <a href="https://github.com/popey/mojinav" target="_blank" rel="noopener noreferrer">
                🐙 popey/mojinav
              </a>
            </p>
          </section>
        </div>
      </div>
    )
  }

  // Settings
  if (view === 'settings') {
    return (
      <div className="app-container">
        <div className="settings-container">
          <button className="back-button" onClick={() => setView('grid')}>⬅️</button>
          <div className="settings-title">⚙️</div>
          <div className="settings-options">
            <button
              className={`unit-button ${distanceUnit === 'feet' ? 'selected' : ''}`}
              onClick={() => setDistanceUnit('feet')}
            >
              🦶
            </button>
            <button
              className={`unit-button ${distanceUnit === 'meters' ? 'selected' : ''}`}
              onClick={() => setDistanceUnit('meters')}
            >
              Ⓜ️
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Arrived celebration
  if (view === 'arrived') {
    return (
      <div className="app-container celebration">
        <span className="celebration-emoji">🎉</span>
        <button className="retry-button" onClick={goBack}>🏠</button>
      </div>
    )
  }

  // Results map view
  if (view === 'results' && location && searchResults.length > 0) {
    const amenity = AMENITIES.find(a => a.id === selectedAmenity)
    const bounds: [number, number][] = [
      [location.lat, location.lng],
      ...searchResults.map(r => [r.lat, r.lng] as [number, number])
    ]

    return (
      <div className="map-view">
        <button className="map-back-button" onClick={goBack}>⬅️</button>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="copyright-button"
        >
          ©️
        </a>
        <MapContainer
          center={[location.lat, location.lng]}
          zoom={15}
          className="map-container"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png"
          />
          <FitBounds bounds={bounds} />

          {/* User location */}
          <Marker position={[location.lat, location.lng]} icon={createEmojiIcon('📍', 40)}>
            <Popup>📍</Popup>
          </Marker>

          {/* Search results */}
          {searchResults.map((result) => {
            const dist = calculateDistance(location.lat, location.lng, result.lat, result.lng)
            return (
              <Marker
                key={result.id}
                position={[result.lat, result.lng]}
                icon={createEmojiIcon(amenity?.emoji || '📍', 36)}
                eventHandlers={{
                  click: () => handleDestinationSelect(result)
                }}
              >
                <Popup className="emoji-popup">
                  <div className="marker-popup">
                    <span className="popup-emoji">{amenity?.emoji}</span>
                    <span className="popup-distance">{formatDistance(dist, distanceUnit)}</span>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
    )
  }

  // Navigation view
  if (view === 'navigating' && location && route && selectedDestination) {
    const amenity = AMENITIES.find(a => a.id === selectedAmenity)
    const currentStep = route.steps[currentStepIndex]
    const nextStep = route.steps[currentStepIndex + 1]
    const arrow = MANEUVER_ARROWS[currentStep?.type ?? 6] || '⬆️'
    const routeCoords = route.coordinates.map(c => [c[1], c[0]] as [number, number])

    return (
      <div
        className="navigation-view"
        style={{ '--map-bearing': `${bearing}deg` } as React.CSSProperties}
      >
        <button className="map-back-button" onClick={goBack}>⬅️</button>
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="copyright-button"
        >
          ©️
        </a>

        <div className="nav-map-section">
          {/* Oversized wrapper so the visible viewport stays covered when
              the map rotates. Both rotation and counter-rotation of marker
              glyphs are driven by the --map-bearing CSS variable set on
              the navigation-view above. */}
          <div className="map-rotation-wrapper">
            <MapContainer
              center={[location.lat, location.lng]}
              zoom={17}
              className="map-container"
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url="https://tiles.stadiamaps.com/tiles/stamen_toner_background/{z}/{x}/{y}{r}.png"
              />
              <MapUpdater center={[location.lat, location.lng]} />

              {/* Route line */}
              <Polyline positions={routeCoords} color="#4CAF50" weight={5} opacity={0.8} />

              {/* User location */}
              <Marker position={[location.lat, location.lng]} icon={createEmojiIcon('📍', 40)} />

              {/* Destination */}
              <Marker
                position={[selectedDestination.lat, selectedDestination.lng]}
                icon={createEmojiIcon(amenity?.emoji || '🏁', 36)}
              />
            </MapContainer>
          </div>
        </div>

        <div className="nav-instructions">
          <div className="current-instruction">
            <span className="instruction-arrow">{arrow}</span>
            <span className="instruction-distance">
              {formatDistance(currentStep?.distance || 0, distanceUnit)}
            </span>
          </div>
          {nextStep && (
            <div className="next-instruction">
              <span className="next-arrow">{MANEUVER_ARROWS[nextStep.type] || '⬆️'}</span>
              <span className="next-distance">
                {formatDistance(nextStep.distance, distanceUnit)}
              </span>
            </div>
          )}
          <div className="total-distance">
            {formatDistance(route.distance, distanceUnit)}
          </div>
        </div>
      </div>
    )
  }

  // Main grid view
  return (
    <div className="app-container">
      <button className="about-button" onClick={() => setView('about')}>ℹ️</button>
      <button className="settings-button" onClick={() => setView('settings')}>⚙️</button>
      <div className="grid-container">
        {AMENITIES.map((amenity) => (
          <button
            key={amenity.id}
            className="amenity-button"
            onClick={() => handleAmenitySelect(amenity.id)}
          >
            {amenity.emoji}
          </button>
        ))}
      </div>
      {location && <div className="location-indicator">📍</div>}
    </div>
  )
}

export default App
