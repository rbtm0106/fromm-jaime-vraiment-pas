/**
 * Shared Core Asset for Fromm Web Player (assets/common.js)
 * Centralizes authentication, session timer, API calls, CloudFront/HLS parsing,
 * subtitle manifest caching, and AES-128 .ts stream downloading.
 * Works with the original unmodified assets/i18n/i18n.js & i18n_data.js.
 */
(function () {
    const API_BASE = {
        ACCOUNT: 'https://account-api.frommyarti.com',
        CHANNEL: 'https://channel-api.frommyarti.com'
    };

    const STORAGE_KEYS = {
        ACCESS_TOKEN: 'fromm_access_token',
        REFRESH_TOKEN: 'fromm_refresh_token',
        RESOURCE_TOKEN: 'fromm_resource_token',
        TOKEN_EXPIRY: 'fromm_token_expiry',
        DEVICE_ID: 'fromm_device_id',
        DOWNLOADED: 'fromm_downloaded',
        SUBS_CACHE: 'fromm_subs_manifest_cache'
    };

    const FALLBACK_TEXT = {
        btn_download: 'Download Video',
        btn_copy_link: 'Copy Shared Link',
        title_downloaded: 'Downloaded - Click to download again',
        error_session_expired: 'Session expired. Please log in again.',
        status_fetching_keys: 'Fetching keys...',
        status_parsing_playlist: 'Parsing playlist...',
        status_fetching_aes: 'Fetching AES Decryption Key...',
        status_downloading_decrypting: 'Downloading & Decrypting...',
        status_saving_file: 'Saving file...',
        status_error: 'Error'
    };

    let sessionTimerInterval = null;
    let downloadedSet = null;
    let subsManifestMemoryCache = null;
    let i18nLoadedFired = false;
    const readyCallbacks = [];
    const activeDownloads = new Set();

    // Track i18nLoaded event regardless of script load order
    window.addEventListener('i18nLoaded', () => {
        i18nLoadedFired = true;
        while (readyCallbacks.length > 0) {
            const cb = readyCallbacks.shift();
            try { cb(); } catch (e) { console.error(e); }
        }
    });

    function onReady(callback) {
        if (i18nLoadedFired || window.i18nReady) {
            callback();
            return;
        }
        let called = false;
        const wrapped = () => {
            if (called) return;
            called = true;
            callback();
        };
        readyCallbacks.push(wrapped);

        // Fallback in case DOMContentLoaded already fired before listener attached
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            setTimeout(() => {
                if (!called) {
                    if (typeof window.initI18n === 'function' && !i18nLoadedFired) {
                        try { window.initI18n(); } catch (e) {}
                    }
                    wrapped();
                }
            }, 50);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => {
                    if (!called) wrapped();
                }, 50);
            });
        }
    }

    function tr(key) {
        if (typeof window.t === 'function') {
            const val = window.t(key);
            if (val && val !== key) return val;
        }
        return FALLBACK_TEXT[key] || key;
    }

    const kstFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });

    // --- UTILITIES ---
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatKST(timestampMs) {
        try {
            return kstFormatter.format(new Date(timestampMs));
        } catch (e) {
            return String(timestampMs);
        }
    }

    function formatTime(time) {
        if (isNaN(time) || time < 0) return '00:00';
        const sec = Math.floor(time % 60);
        const min = Math.floor((time / 60) % 60);
        const hrs = Math.floor(time / 3600);
        return hrs > 0
            ? `${hrs}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
            : `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    }

    function getCookie(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift().trim();
        return null;
    }

    // --- AUTH & SESSION ---
    function getToken() {
        return localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
    }

    function getOrCreateDeviceId(customInputId) {
        let id = customInputId ? customInputId.trim() : '';
        if (!id) {
            id = getCookie('deviceId') || getCookie('device_id') || getCookie('fromm_device_id')
                || localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
        }
        if (!id) {
            id = crypto.randomUUID();
        }
        localStorage.setItem(STORAGE_KEYS.DEVICE_ID, id);
        return id;
    }

    function clearSession() {
        localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.RESOURCE_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.TOKEN_EXPIRY);
    }

    function logout() {
        if (sessionTimerInterval) clearInterval(sessionTimerInterval);
        clearSession();
        window.location.replace('index.html');
    }

    function requireAuth() {
        const token = getToken();
        if (!token) {
            window.location.replace('index.html');
            return null;
        }
        return token;
    }

    function startSessionTimer() {
        const expiryStr = localStorage.getItem(STORAGE_KEYS.TOKEN_EXPIRY);
        if (!expiryStr) return;

        const expiryTimestamp = parseInt(expiryStr, 10);
        const timerContainer = document.getElementById('session-timer');
        const timeSpan = document.getElementById('time-remaining');
        if (!timerContainer || !timeSpan) return;

        timerContainer.classList.remove('hidden');
        if (sessionTimerInterval) clearInterval(sessionTimerInterval);

        function updateTimer() {
            const now = Math.floor(Date.now() / 1000);
            const diff = expiryTimestamp - now;

            if (diff <= 0) {
                logout();
                return;
            }

            const hours = Math.floor(diff / 3600);
            const minutes = Math.floor((diff % 3600) / 60);
            const seconds = diff % 60;

            timeSpan.textContent = hours > 0
                ? `${hours}h ${minutes}m`
                : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

            if (diff <= 300) {
                timeSpan.className = 'text-yellow-400 font-bold animate-pulse';
                timerContainer.classList.add('border-yellow-600');
            }
        }

        updateTimer();
        sessionTimerInterval = setInterval(updateTimer, 1000);
    }

    function initPageCommon({ requireLogin = true } = {}) {
        const token = requireLogin ? requireAuth() : getToken();
        startSessionTimer();

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn && !logoutBtn.dataset.bound) {
            logoutBtn.dataset.bound = 'true';
            logoutBtn.addEventListener('click', logout);
        }

        refreshIcons();
        return token;
    }

    // --- API & STREAM HELPERS ---
    async function apiFetch(pathOrUrl, { method = 'GET', channelId = null, body = null, headers = {} } = {}) {
        const token = getToken();
        const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE.CHANNEL}${pathOrUrl}`;

        const reqHeaders = {
            'Content-Type': 'application/json',
            'uuid': crypto.randomUUID(),
            ...headers
        };
        if (token) reqHeaders['Authorization'] = token;
        if (channelId) reqHeaders['channel-id'] = channelId;

        const response = await fetch(url, {
            method,
            headers: reqHeaders,
            body: body ? JSON.stringify(body) : undefined
        });

        if (response.status === 401 || response.status === 403) {
            clearSession();
            setTimeout(() => window.location.replace('index.html'), 1500);
            throw new Error(tr('error_session_expired'));
        }

        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }

        return response.json();
    }

    async function fetchPostDetails(postId, channelId) {
        const data = await apiFetch(`/media/posts/${postId}`, { channelId });
        if (!data || !data.data || !data.data.post) throw new Error('Invalid post response.');
        return data.data.post;
    }

    function parseCloudFrontParams(rawUrl) {
        const match = rawUrl && rawUrl.match(/CloudFront-Key-Pair-Id=([^&]+)&CloudFront-Signature=([^&]+)&CloudFront-Policy=([^&]+)/);
        if (!match) throw new Error('No CloudFront keys found in URL.');
        return `Key-Pair-Id=${match[1]}&Signature=${match[2]}&Policy=${match[3]}`;
    }

    function resolveMasterM3u8Url(rawUrl, postType) {
        let masterUrl = rawUrl.split('?')[0];
        if (postType === 'live_record' && masterUrl.includes('.m3u8')) {
            const m3u8Match = masterUrl.match(/\S+\.m3u8/);
            if (m3u8Match) {
                const baseSplit = m3u8Match[0].split('_');
                if (baseSplit.length > 1) {
                    masterUrl = baseSplit.slice(0, -1).join('_') + '.' + baseSplit.pop().split('.').pop();
                }
            }
        }
        return masterUrl;
    }

    async function getSubsManifest() {
        if (subsManifestMemoryCache) return subsManifestMemoryCache;

        try {
            const cachedRaw = sessionStorage.getItem(STORAGE_KEYS.SUBS_CACHE);
            if (cachedRaw) {
                const parsed = JSON.parse(cachedRaw);
                if (Date.now() - parsed.timestamp < 5 * 60 * 1000 && parsed.data) {
                    subsManifestMemoryCache = parsed.data;
                    return subsManifestMemoryCache;
                }
            }
        } catch (e) {}

        // Try relative path first, then root /assets/ fallback if testing in a subfolder like /argon/
        const candidatePaths = ['assets/subs_manifest.json', '/assets/subs_manifest.json'];
        for (const path of candidatePaths) {
            try {
                const res = await fetch(path);
                if (res.ok) {
                    const data = await res.json();
                    subsManifestMemoryCache = data;
                    try {
                        sessionStorage.setItem(STORAGE_KEYS.SUBS_CACHE, JSON.stringify({
                            timestamp: Date.now(),
                            data
                        }));
                    } catch (e) {}
                    return data;
                }
            } catch (e) {}
        }

        subsManifestMemoryCache = {};
        return subsManifestMemoryCache;
    }

    // --- DOWNLOAD STATE & AES-128 HLS DOWNLOADER ---
    function getDownloadedSet() {
        if (!downloadedSet) {
            try {
                const arr = JSON.parse(localStorage.getItem(STORAGE_KEYS.DOWNLOADED) || '[]');
                downloadedSet = new Set(arr.map(String));
            } catch (e) {
                downloadedSet = new Set();
            }
        }
        return downloadedSet;
    }

    function getDownloadedList() {
        return Array.from(getDownloadedSet());
    }

    function isDownloaded(postId) {
        return getDownloadedSet().has(String(postId));
    }

    function markAsDownloaded(postId) {
        const set = getDownloadedSet();
        const idStr = String(postId);
        if (!set.has(idStr)) {
            set.add(idStr);
            localStorage.setItem(STORAGE_KEYS.DOWNLOADED, JSON.stringify(Array.from(set)));
        }
    }

    function getDownloadButtons(postId) {
        const idStr = String(postId);
        const byId = document.getElementById(`dl-btn-${idStr}`);
        const byAttr = Array.from(document.querySelectorAll(`[data-dl-post-id="${idStr}"]`));
        if (byId && !byAttr.includes(byId)) byAttr.unshift(byId);
        return byAttr;
    }

    function updateButtonUI(postId, shouldRefreshIcons = true) {
        const downloaded = isDownloaded(postId);
        const buttons = getDownloadButtons(postId);
        if (!buttons.length) return;

        buttons.forEach(btn => {
            const labelEl = btn.querySelector('.dl-btn-label');
            if (downloaded) {
                btn.classList.remove('bg-black/60', 'bg-gray-800', 'hover:bg-blue-600', 'hover:bg-gray-700', 'text-white', 'text-gray-300', 'border-gray-700');
                btn.classList.add('bg-green-900/80', 'hover:bg-green-600', 'text-green-400', 'border', 'border-green-600');
                btn.title = tr('title_downloaded');
                btn.innerHTML = labelEl
                    ? `<i data-lucide="check-check" class="w-4 h-4"></i><span class="dl-btn-label text-xs font-medium hidden sm:inline">${escapeHtml(labelEl.textContent)}</span>`
                    : '<i data-lucide="check-check" class="w-4 h-4"></i>';
            } else {
                btn.title = tr('btn_download');
                btn.innerHTML = labelEl
                    ? `<i data-lucide="download" class="w-4 h-4"></i><span class="dl-btn-label text-xs font-medium hidden sm:inline">${escapeHtml(labelEl.textContent)}</span>`
                    : '<i data-lucide="download" class="w-4 h-4"></i>';
            }
        });

        if (shouldRefreshIcons) {
            refreshIcons();
        }
    }

    async function fetchWithRetry(url, retries = 3) {
        let lastErr;
        for (let attempt = 0; attempt < retries; attempt++) {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res;
            } catch (err) {
                lastErr = err;
                if (attempt < retries - 1) {
                    await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
                }
            }
        }
        throw lastErr;
    }

    async function downloadVideo(postId, channelId, cachedPost = null) {
        const idStr = String(postId);
        if (activeDownloads.has(idStr)) return;

        const buttons = getDownloadButtons(idStr);
        const progressContainer = document.getElementById(`progress-container-${idStr}`) || document.getElementById('player-progress-container');
        const progressBar = document.getElementById(`progress-bar-${idStr}`) || document.getElementById('player-progress-bar');
        const progressStatus = document.getElementById(`progress-status-${idStr}`) || document.getElementById('player-progress-status');
        const progressText = document.getElementById(`progress-text-${idStr}`) || document.getElementById('player-progress-text');

        activeDownloads.add(idStr);
        buttons.forEach(btn => {
            btn.disabled = true;
            const labelEl = btn.querySelector('.dl-btn-label');
            btn.innerHTML = labelEl
                ? `<i data-lucide="loader-2" class="w-4 h-4 animate-spin text-blue-400"></i><span class="dl-btn-label text-xs font-medium hidden sm:inline">${escapeHtml(labelEl.textContent)}</span>`
                : '<i data-lucide="loader-2" class="w-4 h-4 animate-spin text-blue-400"></i>';
        });
        refreshIcons();

        try {
            if (progressContainer) {
                progressContainer.classList.remove('hidden');
                progressStatus.classList.remove('text-red-500');
                progressBar.classList.remove('bg-red-500');
                progressBar.classList.add('bg-blue-500');
                progressBar.style.width = '0%';
                progressStatus.textContent = tr('status_fetching_keys');
                progressText.textContent = '';
            }

            const post = (cachedPost && cachedPost.url) ? cachedPost : await fetchPostDetails(idStr, channelId);
            const rawUrl = post.url;
            const postType = post.type;

            const cloudFrontParams = parseCloudFrontParams(rawUrl);
            const masterUrl = resolveMasterM3u8Url(rawUrl, postType);

            const masterText = await (await fetchWithRetry(`${masterUrl}?${cloudFrontParams}`)).text();
            let subText = '';
            let subBaseUrl = '';

            const m3u8Lines = masterText.split('\n').map(l => l.trim()).filter(l => l.includes('.m3u8') && !l.startsWith('#'));

            if (m3u8Lines.length > 0) {
                let subUrl = postType === 'live_record' ? m3u8Lines[0] : m3u8Lines[m3u8Lines.length - 1];
                const baseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
                if (!subUrl.startsWith('http')) subUrl = baseUrl + subUrl;

                const sep = subUrl.includes('?') ? '&' : '?';
                subText = await (await fetchWithRetry(`${subUrl}${sep}${cloudFrontParams}`)).text();
                subBaseUrl = subUrl.substring(0, subUrl.lastIndexOf('/') + 1);
            } else {
                subText = masterText;
                subBaseUrl = masterUrl.substring(0, masterUrl.lastIndexOf('/') + 1);
            }

            if (progressStatus) progressStatus.textContent = tr('status_parsing_playlist');

            let cryptoKey = null;
            let globalIv = null;
            let mediaSequence = 0;

            const seqMatch = subText.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
            if (seqMatch) mediaSequence = parseInt(seqMatch[1], 10);

            const keyMatch = subText.match(/#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"(?:,IV=0x([0-9A-Fa-f]+))?/);
            if (keyMatch) {
                if (progressStatus) progressStatus.textContent = tr('status_fetching_aes');
                let keyUrl = keyMatch[1];
                if (!keyUrl.startsWith('http')) keyUrl = subBaseUrl + keyUrl;
                if (!keyUrl.includes('Key-Pair-Id')) {
                    keyUrl += (keyUrl.includes('?') ? '&' : '?') + cloudFrontParams;
                }

                const keyRes = await fetchWithRetry(keyUrl);
                const keyData = await keyRes.arrayBuffer();
                cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'AES-CBC' }, false, ['decrypt']);

                if (keyMatch[2]) {
                    const hexString = keyMatch[2].padStart(32, '0');
                    globalIv = new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
                }
            }

            const tsUrls = subText.split('\n')
                .map(line => line.trim())
                .filter(line => line.endsWith('.ts') || line.includes('.ts?'))
                .map(tsUrl => {
                    if (!tsUrl.startsWith('http')) tsUrl = subBaseUrl + tsUrl;
                    if (!tsUrl.includes('Key-Pair-Id')) {
                        tsUrl += (tsUrl.includes('?') ? '&' : '?') + cloudFrontParams;
                    }
                    return tsUrl;
                });

            const totalChunks = tsUrls.length;
            if (totalChunks === 0) throw new Error('No video segments (.ts) found in playlist.');

            if (progressStatus) progressStatus.textContent = tr('status_downloading_decrypting');
            if (progressText) progressText.textContent = `0 / ${totalChunks}`;

            const CONCURRENCY_LIMIT = 20;
            let downloadedChunks = new Array(totalChunks);
            let chunksDone = 0;
            let rafPending = false;
            const iterator = tsUrls.entries();

            function scheduleProgressUpdate() {
                if (rafPending) return;
                rafPending = true;
                requestAnimationFrame(() => {
                    rafPending = false;
                    if (progressText) progressText.textContent = `${chunksDone} / ${totalChunks}`;
                    if (progressBar) progressBar.style.width = `${(chunksDone / totalChunks) * 100}%`;
                });
            }

            async function downloadWorker() {
                for (const [index, url] of iterator) {
                    const chunkRes = await fetchWithRetry(url);
                    let chunkBuffer = await chunkRes.arrayBuffer();

                    if (cryptoKey) {
                        let currentIv = globalIv;
                        if (!currentIv) {
                            currentIv = new Uint8Array(16);
                            const view = new DataView(currentIv.buffer);
                            view.setUint32(12, mediaSequence + index, false);
                        }
                        chunkBuffer = await crypto.subtle.decrypt(
                            { name: 'AES-CBC', iv: currentIv },
                            cryptoKey,
                            chunkBuffer
                        );
                    }

                    downloadedChunks[index] = chunkBuffer;
                    chunksDone++;
                    scheduleProgressUpdate();
                }
            }

            const workerCount = Math.min(CONCURRENCY_LIMIT, totalChunks);
            await Promise.all(Array.from({ length: workerCount }, () => downloadWorker()));

            if (progressStatus) progressStatus.textContent = tr('status_saving_file');
            if (progressText) progressText.textContent = '';

            const finalBlob = new Blob(downloadedChunks, { type: 'video/mp2t' });
            const downloadUrl = URL.createObjectURL(finalBlob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `fromm_video_${idStr}.ts`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);
            downloadedChunks = null;

            if (progressContainer) progressContainer.classList.add('hidden');
            markAsDownloaded(idStr);
        } catch (err) {
            console.error('Download error:', err);
            if (progressStatus) {
                progressStatus.textContent = tr('status_error');
                progressStatus.classList.add('text-red-500');
            }
            if (progressBar) {
                progressBar.classList.remove('bg-blue-500');
                progressBar.classList.add('bg-red-500');
            }
        } finally {
            activeDownloads.delete(idStr);
            buttons.forEach(btn => { btn.disabled = false; });
            updateButtonUI(idStr, true);
        }
    }

    window.FrommApp = {
        API_BASE,
        STORAGE_KEYS,
        onReady,
        tr,
        escapeHtml,
        formatKST,
        formatTime,
        refreshIcons,
        getCookie,
        getToken,
        getOrCreateDeviceId,
        clearSession,
        logout,
        requireAuth,
        startSessionTimer,
        initPageCommon,
        apiFetch,
        fetchPostDetails,
        parseCloudFrontParams,
        resolveMasterM3u8Url,
        getSubsManifest,
        getDownloadedList,
        isDownloaded,
        markAsDownloaded,
        updateButtonUI,
        downloadVideo
    };

    window.onI18nReady = onReady;
    window.startSessionTimer = startSessionTimer;
    window.downloadVideo = downloadVideo;
    window.updateButtonUI = updateButtonUI;
    window.formatKST = formatKST;
    window.formatTime = formatTime;
})();