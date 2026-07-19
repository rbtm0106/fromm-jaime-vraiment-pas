const defaultLang = 'ko';
let currentLang = localStorage.getItem('fromm_lang') || defaultLang;
let translations = {};

async function initI18n() {
    try {
        // Fetching from the new dedicated directory
        const res = await fetch('assets/i18n/i18n.json');
        translations = await res.json();
        
        applyTranslations();
        updateSelectUI();
    } catch (e) {
        console.error("Failed to load translations.", e);
    }
}

function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const translation = translations[currentLang]?.[key];
        
        if (translation) {
            el.textContent = translation; 
        }
    });
}

function setLanguage(lang) {
    currentLang = lang;
    localStorage.setItem('fromm_lang', lang); // Saves to browser preferences
    applyTranslations();
    updateSelectUI();
}

// Automatically updates the dropdown to match the saved language
function updateSelectUI() {
    const langSelects = document.querySelectorAll('.lang-selector');
    langSelects.forEach(select => {
        select.value = currentLang;
    });
}

// Listens for changes on any dropdown with the class 'lang-selector'
document.addEventListener('change', (e) => {
    if (e.target.classList.contains('lang-selector')) {
        setLanguage(e.target.value);
    }
});

// Run the initialization when the DOM is ready
document.addEventListener('DOMContentLoaded', initI18n);