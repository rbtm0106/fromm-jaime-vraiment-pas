const defaultLang = 'ko';
let currentLang = localStorage.getItem('fromm_lang') || defaultLang;
let translations = {};

// Global translation function for your JS scripts
window.t = function(key) {
    if (translations[currentLang] && translations[currentLang][key]) {
        return translations[currentLang][key];
    }
    return key; // Fallback to the key name if missing
};

async function initI18n() {
    try {
        const res = await fetch('assets/i18n/i18n.json');
        translations = await res.json();
        
        applyTranslations();
        updateSelectUI();
        
        // Dispatch an event so other scripts know translations are ready
        window.dispatchEvent(new Event('i18nLoaded'));
    } catch (e) {
        console.error("Failed to load translations.", e);
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = window.t(key);
    });
}

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('fromm_lang', lang);
    applyTranslations();
    updateSelectUI();
    
    // Dispatch event so dynamic JS text can update if needed
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

document.addEventListener('DOMContentLoaded', initI18n);