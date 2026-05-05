# MojiNav - An Emoji-Only Navigation App

## Branding

Ⓜ️🍩🌶️📍♑️🔺✌️

M: Ⓜ️ (Metro sign)
O: 🍩 (Doughnut)
J: 🌶️ (Chili - curve shape) 
I: 📍 (Pin)
N: ♑️ (Capricorn)
A: 🔺 (Red triangle)
V: ✌️ (Peace sign)

## The Vibe

We're building a navigation app that speaks exclusively in emoji. No words. No text. Just universal symbols guiding you to the nearest pub, coffee shop, train station, or toilet. Tap 🍺, see the five closest pubs on a map, pick one, and follow emoji arrows until you arrive. Celebrate with 🎉.

This is an entry for Chainguard's Vibelympics - a competition where developers build apps without looking at the code. The AI does all the coding. You're the AI. Make something delightful.

---

## What Success Looks Like

Someone in central London opens this app on their phone. They're hungry. They tap 🍕. Three seconds later, a map shows five nearby pizza places marked with an appropriate emoji (for whatever amenity the user selected, in this case 🍕). They tap the amenity. The screen shifts to navigation mode: a big ➡️ tells them to turn right, with 5️⃣0️⃣🦶 showing fifty feet to go. They walk. The arrow updates. They arrive. Confetti emoji explodes. They eat pizza.

At no point did they read a single word.

---

## The Golden Rule

**Zero text in the user interface.** Everything the user sees must be emoji:
- Buttons are emoji
- Loading indicators are emoji
- Error messages are emoji
- Navigation instructions are emoji
- Even the browser tab title is emoji (Ⓜ️🍩🌶️ℹ️♑️🔺✌️)
- Map copyright notices can be hidden behind a clickable/tappable emoji copyright icon (©️) which opens in another tab
- Use the Stadia.StamenTonerBackground map style to minimise text on the map itself

Text is fine in places users don't see: code comments, console logs (make these verbose - they're our only debugging window), HTML meta tags, documentation. But if a human eyeball can see it in the app, it must be emoji.

---

## The User Journey

**Opening the app:** The user grants location permission (a necessary evil involving system UI we can't control). While we acquire their position, show a pulsing 📍 or spinning 🔄. Once we have their location, display a grid of amenity emoji.

**The emoji grid:** Sixteen large, tappable emoji representing things people search for: pubs, cafes, train stations, swimming pools, gyms, parks, pizza places, fast food, petrol stations, pharmacies, ATMs, supermarkets, public toilets, parking, libraries, cinemas. Four columns, big touch targets, satisfying tap feedback. Mobile-first - this should look great on an iPhone SE.

**Searching:** User taps an emoji. Show a searching animation (🔍 with some life to it). Query OpenStreetMap data for the five nearest matching amenities. This might take a moment - the free APIs aren't always fast.

**The map:** Full-screen map appears showing the user's location (an enlarged 📍 comparable with the other emoji sizes) and up to five results marked with the amenity-appropriate emoji. The map should fit all markers comfortably. Show the distance to each option using emoji numbers and a foot (for feet, or M for meters) emoji (like 1️⃣5️⃣0️⃣🦶 for 150 feet, or e 1️⃣5️⃣0️⃣Ⓜ️ for 150 meters), beneath the amenity emoji on the map. A back button (⬅️) returns to the grid. No results? Show 🔍❌ with a way to go back.

**Selecting a destination:** User taps one of the emoji markers on the map. We fetch walking directions.

**Navigation:** The screen splits - map on top showing the route line and user position, instructions below. Current instruction is prominent: an arrow emoji (⬆️➡️⬅️↗️↖️↩️) plus distance in emoji. Next instruction previews below, smaller. The map follows the user as they walk. When they're close enough to a waypoint, advance to the next instruction.

**Going off-route:** If the user strays too far from the route, recalculate. Show 🔄 to indicate recalculation, but only once it's already waiting. Don't spam recalculations - once every ten seconds maximum. But don't bother the user about this.

**Arrival:** When they reach the destination, celebrate! 🎉 with animation. Auto-dismiss after a few seconds, or let them tap to return to the grid.

**Errors:** Location denied? 📍🚫 with retry. Network failed? 🌐❌ with retry. No results found? 🔍❌. Rate limited? 🐢. Every error state should have a way to recover or go back.

---

## Technical Requirements

**Two containers:** A Python backend (FastAPI) and a React frontend (Vite). They communicate over HTTP. The frontend proxies API requests to the backend during development.

**Chainguard base images:** Use Chainguard's container images for Python and Node. These images run as non-root users by default - that's a security feature, not a bug. If you encounter permission errors during builds, the solution is fixing file ownership, not switching to root. The node image runs as a user called "node". The python image runs as a user called "nonroot". Files copied into the container need to be owned by these users.

**Development workflow:** Everything runs in Docker via docker-compose. Hot-reload must work - changing frontend code should instantly reflect in the browser, changing backend code should restart the server. No installing node or python on the host machine.

**Package management:** Use uv for Python dependencies. Regular npm for the frontend.

**External APIs:**
- OpenStreetMap's Overpass API for finding amenities. It's free but rate-limited (one request per second). Be kind - cache results.
- OpenRouteService for walking directions. Requires an API key (provided via environment variable ORS_API_KEY). Free tier is generous but not infinite. Cache routes too.

**Important:** Consult the ORS API documentation for the response format - the geometry field may be returned as an encoded polyline string that requires decoding, not raw coordinates. Use a polyline decoding library or algorithm if needed.

**Environment files:** The completed `.env` file must be placed in the same directory as`docker-compose.yml` (the project root). Docker Compose automatically loads variables from this file and passes them to containers via the `environment` section.

**Caching:** Implement simple in-memory caching with expiration. Search results can be cached for five minutes. Routes can be cached for ten minutes. Log cache hits and misses.

**Rate limiting:** Protect the backend from abuse. Thirty search requests per minute per IP, sixty route requests per minute per IP. Return a turtle emoji (🐢) when rate limited.

**Geolocation:** The browser's geolocation API requires HTTPS except on localhost. The developer will use Tailscale or ngrok to access the app from their phone over HTTPS while it runs on their laptop. Don't hardcode localhost anywhere - use relative API paths.

---

## Quality Bar

**For the judges:** This code will be reviewed. Clean architecture matters. Meaningful commit messages matter. Good documentation matters.

**For the demo:** The developer will record a video walking around London using this app. It needs to actually work on a real phone in the real world. Smooth animations, clear feedback, no mysterious failures.

**For the spirit of the competition:** We're proving that AI can build useful, polished software. Don't ship jank.

---

## Amenity Details

Each amenity has an emoji, maps to specific OpenStreetMap tags, and has an appropriate search radius:

🍺 Pubs - search within 1km
☕ Cafes - 800m
🚂 Train stations - 2km
🏊 Swimming pools - 2km
💪 Gyms and fitness centres - 1.5km
🌳 Parks - 1km
🍕 Pizza restaurants - 1km
🍔 Fast food - 800m
⛽ Petrol/fuel stations - 2km
💊 Pharmacies - 1.5km
🏧 ATMs - 1km
🛒 Supermarkets - 1.5km
🚻 Public toilets - 500m (urgent needs!)
🅿️ Parking - 800m
📚 Libraries - 2km
🎬 Cinemas - 2km

---

## Direction Arrows

OpenRouteService returns maneuver types. Map them to arrows:

- Going straight or continuing: ⬆️
- Slight right: ↗️
- Right turn: ➡️
- Slight left: ↖️
- Left turn: ⬅️
- U-turn: ↩️
- Arrived at destination: 🏁

Sharp turns can use the same arrows as regular turns, or ⤵️/⤴️ if you want to distinguish them.

---

## Settings

A settings component (⚙️) accessible from the emoji grid, via an emoji button in the top right, allows toggling:
- Distance units: feet (🦶) or meters (Ⓜ️)

Retain the settings in local storage so they persist across sessions.

---

## Distance Display

Show distances in feet or meters using emoji numerals: 1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣0️⃣ followed by 🦶 or Ⓜ️.

150 feet = 1️⃣5️⃣0️⃣🦶
150 meters = 1️⃣5️⃣0️⃣Ⓜ️

For longer distances over 1000 feet, switch to miles with a ruler emoji: 0️⃣.3️⃣📏
For longer distances over 1000 meters, switch to kilometers with a ruler emoji: 0️⃣.3️⃣📏
The backend returns meters. Convert to feet for display for our friends over the pond (multiply by 3.28084) if that setting has been chosen.

---

## Navigation Logic

**Position tracking:** Watch the user's position with high accuracy. Update frequently. Do not bother the user if it fails sometimes, only if there are consistent failures.

**Step progression:** When the user gets within approximately 20 feet / 6 meters of where a step ends, advance to the next instruction.

**Off-route detection:** Calculate distance from the user's position to the nearest point on the route. If they're more than 5-10 meters away, they've wandered off. Fetch a new route from their current position.

**Recalculation debounce:** Don't recalculate more than once every 10 seconds. GPS can be jittery.

**Arrival detection:** When within 20 meters of the final destination, trigger the celebration.

---

## Development Phases

Work through these phases in order, committing after each one. Comprehensive commit messages help judges understand the journey.

**Phase 0 - Foundation:** Get docker-compose working with both containers. Backend serves a health endpoint. Frontend loads and can call the backend. Hot-reload works. This is the foundation - don't proceed until it's solid.

**Phase 1 - The Grid:** Implement geolocation and the emoji grid. User grants permission, sees the grid of amenities. Loading and error states work.

**Phase 2 - The Backend:** Build the search and routing endpoints. Caching and rate limiting work. Test with curl or the browser console.

**Phase 3 - The Map:** Connect frontend to backend. Tapping an amenity searches and displays results on a map. User can select a destination.

**Phase 4 - Navigation:** Implement turn-by-turn navigation. Position updates, instructions change, off-route detection triggers recalculation, arrival celebrates.

**Phase 5 - Polish:** Smooth animations, thorough error handling, documentation, final testing on a real phone.

---

## Working Style

**Be autonomous.** Make reasonable decisions without asking for clarification. If something is ambiguous, pick the sensible option and note your choice in a commit message or code comment.

**Use tessl if available.** Search for existing tiles that might help - FastAPI scaffolds, React patterns, Docker configurations, whatever's relevant.

**Commit often.** After each phase, after any significant milestone. Judges will read the git log.

**Log verbosely.** Console output is our only window into what's happening. When something goes wrong, we need to know what and why.

**Test on mobile.** Open the app on your phone (via tailscale/ngrok for HTTPS) and actually try to use it. The browser devtools mobile simulator lies.

---

## When Things Go Wrong

Permission errors in Docker usually mean file ownership issues with Chainguard images. Fix ownership in the Dockerfile, don't run as root.

Frontend can't reach backend API? The Vite dev server needs to proxy API requests since the browser can't resolve Docker service names.

Geolocation fails on mobile? You're probably not using HTTPS.

Overpass queries timing out? The free server can be slow. Add reasonable timeouts and show clear loading states on serious failures.

Hot reload not working? Check that volume mounts are set up correctly and files are readable.

If you get truly stuck on something, commit what you have with a note about what's blocking, and move on. Progress over perfection.

---

## Definition of Done

- `docker compose up` starts both containers cleanly
- App loads on a mobile browser over HTTPS
- Location permission works on iOS Safari and Android Chrome
- At least five different amenity types successfully return results
- Map shows numbered markers for results
- Selecting a marker starts navigation
- Navigation instructions update as the user moves
- Going off-route triggers recalculation
- Arrival shows celebration
- Every error state displays appropriate emoji
- Zero text visible anywhere in the UI
- Browser tab shows Ⓜ️🍩🌶️📍♑️🔺✌️
- README explains how to run the app
- Git history shows meaningful progression

---

## Final Thought

The best demo will be someone actually using this app to find a pub in London. Make something that works in the real world, looks good on camera, and brings a smile. The emoji constraint isn't a limitation - it's an opportunity to prove that good UX transcends language.

Now go build it. 🧭
