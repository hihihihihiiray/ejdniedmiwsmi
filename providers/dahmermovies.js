// Dahmer Movies Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[DahmerMovies] Initializing Dahmer Movies scraper');

const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const DAHMER_MOVIES_API = 'https://a.111477.xyz';
const TIMEOUT = 22000; 

function makeRequest(url, options = {}) {
    return fetch(url, {
        timeout: TIMEOUT,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3 Safari/605.1.15',
            ...options.headers
        },
        ...options
    }).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
    });
}

function getTVTitleVariants(title, year) {
    const cleanTitle = title.replace(/:/g, '');
    const dashTitle = title.replace(/:/g, ' -');
    return [...new Set([title, cleanTitle, dashTitle, `${title} (${year})`, `${cleanTitle} (${year})`, `${dashTitle} (${year})`])]
           .filter(v => v);
}

function getEpisodeSlug(season, episode) {
    const s = season < 10 ? `0${season}` : `${season}`;
    const e = episode < 10 ? `0${episode}` : `${episode}`;
    return [s, e];
}

function parseLinks(html) {
    const links = [];
    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(html)) !== null) {
        const rowContent = rowMatch[1];
        const linkMatch = rowContent.match(/<a[^>]*href=["']([^"']*)["'][^>]*>([^<]*)<\/a>/i);
        if (!linkMatch) continue;
        const href = linkMatch[1];
        const text = linkMatch[2].trim();
        if (!text || href === '../' || text === '../') continue;
        let size = null;
        const sizeMatch = rowContent.match(/<td[^>]*data-sort=["']?(\d+)["']?[^>]*>/i) || 
                          rowContent.match(/<td[^>]*class=["']filesize["'][^>]*>([^<]+)<\/td>/i);
        if (sizeMatch) size = sizeMatch[1];
        links.push({ text, href, size });
    }
    return links;
}

function resolvePath(path, baseUrl) {
    let fullUrl;
    const cleanHref = path.href.split('/').map(p => encodeURIComponent(decodeURIComponent(p))).join('/');
    if (path.href.startsWith('http')) {
        fullUrl = path.href;
    } else {
        const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
        fullUrl = base + cleanHref;
    }

    const proxiedUrl = `https://p.111477.xyz/bulk?u=${fullUrl}`;

    const sizeBytes = (function(s) {
        if (!s) return 0;
        const match = s.match(/(\d+(?:\.\d+)?)\s*([GKMTe]B|Bytes?)/i);
        if (match) {
            const val = parseFloat(match[1]);
            const unit = match[2].toUpperCase();
            const pow = {'BYTES': 0, 'B': 0, 'KB': 1, 'MB': 2, 'GB': 3, 'TB': 4}[unit] || 0;
            return val * Math.pow(1024, pow);
        }
        return parseInt(s) || 0;
    })(path.size);

    return {
        name: "DahmerMovies",
        title: path.text,
        url: proxiedUrl,
        size: path.size, 
        sizeBytes: sizeBytes,
        type: "direct",
        provider: "dahmermovies",
        filename: path.text
    };
}

async function invokeDahmerMovies(title, year, season = null, episode = null) {
    const titleVariants = season === null 
        ? [`${title.replace(/:/g, '')} (${year})`, title.replace(/:/g, '')] 
        : getTVTitleVariants(title, year);

    let html = null;
    let finalBaseUrl = null;

    for (const variant of titleVariants) {
        const safeVariant = encodeURIComponent(variant);
        if (season === null) {
            const tryUrl = `${DAHMER_MOVIES_API}/movies/${safeVariant}/`;
            try {
                const res = await makeRequest(tryUrl);
                html = await res.text();
                if (html.includes('<a')) { finalBaseUrl = tryUrl; break; }
            } catch (e) { continue; }
        } else {
            const seasonOptions = [`Season%20${season}`, `Season%20${season < 10 ? '0' + season : season}`];
            for (const sFolder of seasonOptions) {
                const tryUrl = `${DAHMER_MOVIES_API}/tvs/${safeVariant}/${sFolder}/`;
                try {
                    const res = await makeRequest(tryUrl);
                    const text = await res.text();
                    if (text && text.includes('<a')) {
                        html = text;
                        finalBaseUrl = tryUrl;
                        break;
                    }
                } catch (e) { continue; }
            }
            if (html) break;
        }
    }

    if (!html) return [];

    
    const paths = parseLinks(html);
    let filteredPaths;
    
    if (season === null) {
        filteredPaths = paths.filter(path => /2160p/i.test(path.text));
        if (filteredPaths.length === 0) {
            filteredPaths = paths.filter(path => /1080p/i.test(path.text)).slice(0, 5);
        }
    } else {
        const [seasonSlug, episodeSlug] = getEpisodeSlug(season, episode);
        const patterns = [
            new RegExp(`S${seasonSlug}E${episodeSlug}`, 'i'),
            new RegExp(`${parseInt(season)}x${episodeSlug}`, 'i'),
            new RegExp(`E${episodeSlug}(?!\\d)`, 'i'),
            new RegExp(`Episode[\\s._-]*${episodeSlug}(?!\\d)`, 'i')
        ];
        filteredPaths = paths.filter(path => patterns.some(pattern => pattern.test(path.text)));
    }

    if (filteredPaths.length === 0) return [];
    
    const pathsToProcess = filteredPaths.slice(0, 5);
    const results = [];

    pathsToProcess.forEach(path => {
        results.push(resolvePath(path, finalBaseUrl));
    });

    // Sort by size: Smallest to Largest
    results.sort((a, b) => a.sizeBytes - b.sizeBytes);
    results.forEach(r => delete r.sizeBytes);
    
    return results;
}

function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    const tmdbUrl = `https://api.themoviedb.org/3/${mediaType === 'tv' ? 'tv' : 'movie'}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    return makeRequest(tmdbUrl).then(res => res.json()).then(data => {
        const title = mediaType === 'tv' ? data.name : data.title;
        const year = mediaType === 'tv' ? data.first_air_date?.substring(0, 4) : data.release_date?.substring(0, 4);
        return invokeDahmerMovies(title, year ? parseInt(year) : null, seasonNum, episodeNum);
    }).catch(() => []);
}

global.getStreams = getStreams;
