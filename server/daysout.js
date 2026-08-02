// "Days out" ideas — real nearby points of interest via the public Overpass API,
// with real photos from Wikimedia Commons and a local fallback list offline.

export const GENERIC_IDEAS = [
  {
    name: 'State or national park',
    description: 'A long walk in the woods clears the head and breaks the loop.',
    url: 'https://www.google.com/maps/search/state+park',
    photoQuery: 'state park trees trail',
  },
  {
    name: 'Community pool or gym',
    description: 'Swimming or a workout session burns nervous energy and fills the afternoon.',
    url: 'https://www.google.com/maps/search/pool',
    photoQuery: 'outdoor swimming pool',
  },
  {
    name: 'Libraries and reading rooms',
    description: 'Quiet, free, and full of things to learn — a calm place to reset.',
    url: 'https://www.google.com/maps/search/library',
    photoQuery: 'public library reading room',
  },
  {
    name: 'Museum or gallery',
    description: 'A change of scenery with an art or history fix.',
    url: 'https://www.google.com/maps/search/museum',
    photoQuery: 'museum art gallery interior',
  },
  {
    name: 'Bike or hike trail',
    description: 'Endorphins and fresh air make urges dramatically easier to ride out.',
    url: 'https://www.google.com/maps/search/hiking+trail',
    photoQuery: 'hiking trail forest',
  },
  {
    name: 'Cinema or theatre',
    description: 'A few uninterrupted hours of story can carry you through a rough evening.',
    url: 'https://www.google.com/maps/search/cinema',
    photoQuery: 'cinema theatre interior',
  },
  {
    name: 'Café with a book',
    description: 'New surroundings, a warm drink, and no screens required.',
    url: 'https://www.google.com/maps/search/cafe',
    photoQuery: 'cozy cafe coffee book',
  },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const photoCache = new Map();
const nearbyCache = new Map();
const NEARBY_TTL_MS = 10 * 60 * 1000;

// Wikimedia throttles anonymous bursts — serialize photo lookups with spacing.
let commonsQueue = Promise.resolve();
function commonsFetch(url) {
  const run = commonsQueue.then(
    () => new Promise((resolve) => setTimeout(resolve, 1200)).then(() => fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'BreakFree/1.0 (habit tracker)' },
    }))
  );
  commonsQueue = run.catch(() => {});
  return run;
}

async function overpass(query) {
  const payload = `data=${encodeURIComponent(query)}`;
  const headers = { 'User-Agent': 'BreakFree/1.0 (habit tracker; contact: admin@breakfree.app)' };
  // Fire every mirror at once and take the first success — fastest path wins,
  // and the whole lookup is capped so a dead network falls back quickly.
  const attempts = OVERPASS_ENDPOINTS.map(async (endpoint) => {
    const res = await fetch(`${endpoint}?${payload}`, { signal: AbortSignal.timeout(10000), headers });
    if (!res.ok) throw new Error(`Overpass API returned HTTP ${res.status}`);
    return res.json();
  });
  const cap = new Promise((_, reject) => setTimeout(() => reject(new Error('Overpass timed out')), 12000));
  try {
    return await Promise.any([...attempts, cap]);
  } catch {
    throw new Error('Overpass API unreachable.');
  }
}

// Fetch one photo thumbnail for a query from Wikimedia Commons. Results are
// cached in memory so repeat loads are instant. Tries progressively looser
// queries so obscure places still find a photo.
export async function fetchPhoto(query) {
  if (!query || !String(query).trim()) return null;
  const key = String(query).trim().toLowerCase();
  if (photoCache.has(key)) return photoCache.get(key);
  const attempts = [
    String(query).trim(),
    String(query).trim().split(/\s+/).slice(0, 3).join(' '),
    String(query).trim().split(/\s+/).slice(0, 2).join(' '),
  ];
  for (const attempt of attempts) {
    try {
      const url =
        `${COMMONS}?action=query&generator=search&gsrsearch=${encodeURIComponent(attempt + ' filetype:bitmap')}` +
        `&gsrnamespace=6&gsrlimit=1&prop=imageinfo&iiprop=url&iiurlwidth=640&format=json&origin=*`;
      const res = await commonsFetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data?.query?.pages;
      if (!pages) continue;
      const page = Object.values(pages)[0];
      const thumb = page?.imageinfo?.[0]?.thumburl;
      if (thumb) {
        photoCache.set(key, thumb);
        return thumb;
      }
      // Definitive miss (200 but nothing relevant) — cache so we don't retry.
      photoCache.set(key, null);
      return null;
    } catch {
      // transient error (timeout / rate limit) — do NOT cache, retry later
    }
  }
  return null;
}

export async function geocodeArea(area) {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(area)}`,
    { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'BreakFree/1.0' } }
  );
  if (!res.ok) throw new Error('Could not look up that area.');
  const hits = await res.json();
  if (!hits.length) throw new Error(`Could not find "${area}" on the map.`);
  return { lat: Number(hits[0].lat), lon: Number(hits[0].lon), displayName: hits[0].display_name };
}

function cleanPhotoQuery(name) {
  return String(name)
    .replace(/\(.*?\)/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join(' ');
}

export async function findNearby(lat, lon, radius, areaName) {
  const r = Math.min(Math.max(Number(radius) || 10000, 1000), 50000);
  const cacheKey = `${lat},${lon},${r},${areaName || ''}`.toLowerCase();
  const cached = nearbyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < NEARBY_TTL_MS) {
    return { ideas: cached.ideas, source: cached.source, cached: true };
  }
  const query = `
    [out:json];
    (
      node["leisure"="park"](around:${r},${lat},${lon});
      node["leisure"="nature_reserve"](around:${r},${lat},${lon});
      node["tourism"="museum"](around:${r},${lat},${lon});
      node["tourism"="attraction"](around:${r},${lat},${lon});
      node["tourism"="artwork"](around:${r},${lat},${lon});
      node["amenity"="library"](around:${r},${lat},${lon});
      node["amenity"="cinema"](around:${r},${lat},${lon});
      node["amenity"="gym"](around:${r},${lat},${lon});
      node["amenity"="swimming_pool"](around:${r},${lat},${lon});
      node["sport"="swimming"](around:${r},${lat},${lon});
      node["leisure"="pitch"](around:${r},${lat},${lon});
    );
    out 30;
  `;
  const data = await overpass(query);

  const icons = {
    park: '🌳',
    nature_reserve: '🌲',
    museum: '🏛️',
    attraction: '📍',
    artwork: '🎨',
    library: '📚',
    cinema: '🎬',
    gym: '💪',
    swimming_pool: '🏊',
    swimming: '🏊',
    pitch: '⚽',
  };

  const ideas = (data.elements || [])
    .filter((e) => e.lat && e.tags)
    .map((e) => {
      const tags = e.tags;
      const icon = icons[tags.leisure] || icons[tags.tourism] || icons[tags.amenity] || icons[tags.sport] || '📍';
      const name =
        tags.name ||
        `${capitalize(tags.leisure || tags.tourism || tags.amenity || tags.sport || 'place')} (unnamed)`;
      const category = capitalize(tags.leisure || tags.tourism || tags.amenity || tags.sport || 'place');
      const photoQuery = cleanPhotoQuery(name) || category;
      return {
        name,
        icon,
        url: `https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lon}`,
        lat: e.lat,
        lon: e.lon,
        photoQuery: areaName ? `${photoQuery} ${areaName.split(',')[0]}` : photoQuery,
      };
    })
    .slice(0, 10);

  const finalIdeas = ideas.length ? ideas : GENERIC_IDEAS;

  // Attach photos to the first few ideas concurrently — a slow photo never
  // blocks the list, and the 10-minute cache makes repeat loads instant.
  const withPhotos = await Promise.all(
    finalIdeas.slice(0, 6).map(async (idea) => {
      const photo = await fetchPhoto(idea.photoQuery || idea.name);
      return { ...idea, photo };
    })
  );

  const result = {
    ideas: withPhotos,
    source: ideas.length ? 'overpass' : 'fallback',
  };
  nearbyCache.set(cacheKey, { ideas: withPhotos, source: result.source, at: Date.now() });
  return result;
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}
