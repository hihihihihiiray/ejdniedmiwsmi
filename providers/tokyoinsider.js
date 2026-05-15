// TokyoInsider Scraper for Nuvio Local Scrapers
// React Native compatible version

console.log('[TokyoInsider] Initializing TokyoInsider scraper');

// Constants
const TMDB_API_KEY = "1c29a5198ee1854bd5eb45dbe8d17d92";
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const ANILIST_API_URL = 'https://graphql.anilist.co';
const BASE_URL = 'https://www.tokyoinsider.com';
const TIMEOUT = 20000;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Referer': BASE_URL + '/'
};

// Helper function to make HTTP requests
function makeRequest(url, options = {}) {
    return fetch(url, {
        timeout: TIMEOUT,
        headers: { ...HEADERS, ...options.headers },
        ...options
    }).then(function(response) {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response;
    });
}

// Get TMDB details
function getTMDBDetails(tmdbId, mediaType) {
    const endpoint = mediaType === 'tv' ? 'tv' : 'movie';
    const url = `${TMDB_BASE_URL}/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;

    return makeRequest(url).then(function(response) {
        return response.json();
    }).then(function(data) {
        const isTv = mediaType === 'tv';
        return {
            title: isTv ? data.name : data.title,
            originalTitle: isTv ? data.original_name : data.original_title,
            year: (isTv ? data.first_air_date : data.release_date)?.substring(0, 4) || '',
            mediaType: isTv ? 'tv' : 'movie'
        };
    }).catch(function(error) {
        console.log(`[TokyoInsider] TMDB lookup failed: ${error.message}`);
        return null;
    });
}

// Get AniList details
function getAniListDetails(title, year, mediaType) {
    const query = `
        query ($search: String, $year: Int, $type: MediaType) {
            Media(search: $search, seasonYear: $year, type: $type) {
                id
                title {
                    romaji
                    english
                    native
                }
            }
        }
    `;

    const variables = {
        search: title,
        year: year ? parseInt(year) : null,
        type: mediaType === 'tv' ? 'ANIME' : 'ANIME'
    };

    return fetch(ANILIST_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables })
    }).then(function(response) {
        return response.json();
    }).then(function(data) {
        if (data.data && data.data.Media) {
            const titles = data.data.Media.title;
            console.log(`[TokyoInsider] AniList found - Romanji: "${titles.romaji}", English: "${titles.english}"`);
            return {
                romaji: titles.romaji,
                english: titles.english,
                native: titles.native
            };
        }
        return null;
    }).catch(function(error) {
        console.log(`[TokyoInsider] AniList lookup failed: ${error.message}`);
        return null;
    });
}

// Format title for URL
function formatTitleForURL(title) {
    return title
        .trim()
        .replace(/ /g, '_')
        .replace(/'/g, '')
        .replace(/:/g, '')
        .replace(/\?/g, '')
        .replace(/!/g, '');
}

// Build TokyoInsider URL
function buildTokyoInsiderURL(title, mediaType, episodeNum) {
    const formattedTitle = formatTitleForURL(title);
    const firstLetter = title.charAt(0).toUpperCase();
    const typeDesignation = mediaType === 'tv' ? '_(TV)' : '_(Movie)';

    const baseAnimeUrl = `${BASE_URL}/anime/${firstLetter}/${formattedTitle}${typeDesignation}`;

    if (mediaType === 'tv' && episodeNum) {
        return `${baseAnimeUrl}/episode/${episodeNum}`;
    } else if (mediaType === 'movie') {
        return `${baseAnimeUrl}/movie/1`;
    }

    return baseAnimeUrl;
}

// Extract download links from page
function extractDownloadInfo(downloadPageUrl) {
    console.log(`[TokyoInsider] Fetching page: ${downloadPageUrl}`);

    return makeRequest(downloadPageUrl).then(function(response) {
        return response.text();
    }).then(function(html) {
        const fileRegex = /<a[^>]+href=["']([^"']*\/download\/[^"']+)["'][^>]*>([^<]*?\.(?:mkv|mp4)[^<]*?)<\/a>/gi;

        let matches = [];
        let match;

        while ((match = fileRegex.exec(html)) !== null) {
            matches.push({
                url: match[1],
                filename: match[2].trim()
            });
        }

        if (matches.length === 0) {
            console.log('[TokyoInsider] No /download/ links found, trying broader search');
            const broadRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>([^<]*?\.(?:mkv|mp4)[^<]*?)<\/a>/gi;

            while ((match = broadRegex.exec(html)) !== null) {
                const href = match[1];
                const filename = match[2].trim();

                if (filename.includes('.mkv') || filename.includes('.mp4')) {
                    matches.push({
                        url: href.startsWith('http') ? href : BASE_URL + href,
                        filename: filename
                    });
                }
            }
        }

        if (matches.length === 0) {
            throw new Error('No .mkv or .mp4 files found');
        }

        console.log(`[TokyoInsider] Found ${matches.length} file(s)`);

        const results = matches.map(function(fileMatch) {
            const downloadUrl = fileMatch.url.startsWith('http') ? fileMatch.url : BASE_URL + fileMatch.url;
            const filename = fileMatch.filename;

            const filenameIndex = html.indexOf(filename);
            if (filenameIndex !== -1) {
                const surroundingText = html.substring(filenameIndex, filenameIndex + 500);
                const sizeMatch = surroundingText.match(/Size:\s*([0-9.]+\s*[KMGT]B)/i) || 
                                 surroundingText.match(/([0-9.]+\s*[KMGT]B)/i);
                const fileSize = sizeMatch ? sizeMatch[1] : null;

                const qualityMatch = filename.match(/(\d{3,4}p)/i);
                const quality = qualityMatch ? qualityMatch[1] : 'Unknown';

                return {
                    url: downloadUrl,
                    filename: filename,
                    size: fileSize,
                    quality: quality
                };
            }

            const qualityMatch = filename.match(/(\d{3,4}p)/i);
            return {
                url: downloadUrl,
                filename: filename,
                size: null,
                quality: qualityMatch ? qualityMatch[1] : 'Unknown'
            };
        });

        return results;
    });
}

// Main scraper function
async function invokeTokyoInsider(tmdbId, mediaType, seasonNum = null, episodeNum = null) {
    console.log(`[TokyoInsider] TMDB ID: ${tmdbId}, Type: ${mediaType}, Episode: ${episodeNum || 'N/A'}`);

    // For TV shows, episode number is required
    if (mediaType === 'tv' && !episodeNum) {
        console.log('[TokyoInsider] ERROR: Episode number is required for TV shows');
        return [];
    }

    try {
        // Get TMDB details
        const mediaInfo = await getTMDBDetails(tmdbId, mediaType);
        if (!mediaInfo) {
            return [];
        }

        console.log(`[TokyoInsider] Title: "${mediaInfo.title}" (${mediaInfo.year})`);

        // Get AniList details (for romanji title)
        const anilistInfo = await getAniListDetails(mediaInfo.title, mediaInfo.year, mediaType);

        // Build list of titles to try (English, Romanji, Original)
        const titlesToTry = [];

        if (anilistInfo && anilistInfo.romaji) {
            titlesToTry.push(anilistInfo.romaji);
        }

        
        if (
            mediaInfo.title &&
            (!anilistInfo || mediaInfo.title !== anilistInfo.romaji)
        ) {
            titlesToTry.push(mediaInfo.title);
        }

        
        if (
            anilistInfo &&
            anilistInfo.english &&
            anilistInfo.english !== mediaInfo.title &&
            anilistInfo.english !== anilistInfo.romaji
        ) {
            titlesToTry.push(anilistInfo.english);
        }

        
        if (
            mediaInfo.originalTitle &&
            mediaInfo.originalTitle !== mediaInfo.title &&
            (!anilistInfo || mediaInfo.originalTitle !== anilistInfo.romaji)
        ) {
            titlesToTry.push(mediaInfo.originalTitle);
        }

        console.log(
            `[TokyoInsider] Will try ${titlesToTry.length} title variation(s)`,
        );

        let downloadInfoArray = null;
        let usedTitle = null;

        // Try each title variation
        for (const title of titlesToTry) {
            try {
                console.log(`[TokyoInsider] Trying with title: "${title}"`);
                const downloadUrl = buildTokyoInsiderURL(title, mediaInfo.mediaType, episodeNum);
                console.log(`[TokyoInsider] URL: ${downloadUrl}`);
                downloadInfoArray = await extractDownloadInfo(downloadUrl);
                usedTitle = title;
                break;
            } catch (error) {
                console.log(`[TokyoInsider] Failed with title "${title}": ${error.message}`);
                continue;
            }
        }

        if (!downloadInfoArray || downloadInfoArray.length === 0) {
            console.log('[TokyoInsider] Could not find content with any title variation');
            return [];
        }

        // Step 4: Build stream objects
        const streams = downloadInfoArray.map(function(downloadInfo) {
            return {
                name: `TokyoInsider${downloadInfo.quality !== 'Unknown' ? ' - ' + downloadInfo.quality : ''}`,
                title: `${downloadInfo.filename}${downloadInfo.size ? '\n' + downloadInfo.size : ''}`,
                url: downloadInfo.url,
                quality: downloadInfo.quality,
                size: downloadInfo.size,
                headers: {
                    'User-Agent': HEADERS['User-Agent'],
                    'Referer': BASE_URL + '/'
                },
                provider: 'tokyoinsider'
            };
        });

        console.log(`[TokyoInsider] Successfully extracted ${streams.length} stream(s) using title "${usedTitle}"`);
        return streams;

    } catch (error) {
        console.error(`[TokyoInsider] Error: ${error.message}`);
        return [];
    }
}

// Main function to get streams
function getStreams(tmdbId, mediaType = 'movie', seasonNum = null, episodeNum = null) {
    console.log(`[TokyoInsider] Fetching streams for TMDB ID: ${tmdbId}, Type: ${mediaType}${seasonNum ? `, S${seasonNum}E${episodeNum}` : ''}`);

    return invokeTokyoInsider(tmdbId, mediaType, seasonNum, episodeNum).catch(function(error) {
        console.error(`[TokyoInsider] Error in getStreams: ${error.message}`);
        return [];
    });
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getStreams };
} else {
    global.getStreams = getStreams;
}
