const defaultLang = 'ko';
let currentLang = localStorage.getItem('fromm_lang') || defaultLang;
window.i18nReady = false;

// Global translation function
window.t = function(key) {
    if (typeof translationsData !== 'undefined' && translationsData[currentLang] && translationsData[currentLang][key]) {
        return translationsData[currentLang][key];
    }
    return key;
};

// Helper to run callback immediately if i18n is already initialized, or wait for event
window.onI18nReady = function(callback) {
    if (window.i18nReady) {
        callback();
    } else {
        window.addEventListener('i18nLoaded', callback, { once: true });
    }
};

function initI18n() {
    applyTranslations();
    updateSelectUI();
    window.i18nReady = true;
    window.dispatchEvent(new Event('i18nLoaded'));
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = window.t(key);
        if (translation !== key) {
            el.textContent = translation;
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const translation = window.t(key);
        if (translation !== key) {
            el.title = translation;
        }
    });
}

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('fromm_lang', lang);
    applyTranslations();
    updateSelectUI();
    window.dispatchEvent(new Event('languageChanged'));
}

function updateSelectUI() {
    const langSelects = document.querySelectorAll('.lang-selector');
    langSelects.forEach(select => {
        select.value = currentLang;
    });
}

document.addEventListener('change', (e) => {
    if (e.target.classList.contains('lang-selector')) {
        setLanguage(e.target.value);
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
} else {
    initI18n();
}
