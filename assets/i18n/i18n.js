const defaultLang = 'ko';
let currentLang = localStorage.getItem('fromm_lang') || defaultLang;

// Global translation function
window.t = function(key) {
    if (typeof translationsData !== 'undefined' && translationsData[currentLang] && translationsData[currentLang][key]) {
        return translationsData[currentLang][key];
    }
    return key; 
};

function initI18n() {
    applyTranslations();
    updateSelectUI();
    window.dispatchEvent(new Event('i18nLoaded'));
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = window.t(key);
        // Only replace text if a translation was successfully found
        if (translation !== key) {
            el.textContent = translation; 
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

// Run immediately when the HTML is done loading
document.addEventListener('DOMContentLoaded', initI18n);