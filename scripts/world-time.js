// ====== MAIN SCRIPT ======
// initHeaderSystem runs on every popup open (drives the header clock).
document.addEventListener('DOMContentLoaded', () => {
    initHeaderSystem();
});

// initializeWorldTime only runs when the World Time section is rendered.
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'worldTimeSection') initializeWorldTime();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('regionSelector')) initializeWorldTime();
});

// ====== THE ULTIMATE 195+ COUNTRY TIMEZONE DICTIONARY ======
const timeZones = {
    africa: {
        "Algeria": "Africa/Algiers", "Angola": "Africa/Luanda", "Benin": "Africa/Porto-Novo", 
        "Botswana": "Africa/Gaborone", "Burkina Faso": "Africa/Ouagadougou", "Burundi": "Africa/Bujumbura", 
        "Cabo Verde": "Atlantic/Cape_Verde", "Cameroon": "Africa/Douala", "Central African Republic": "Africa/Bangui", 
        "Chad": "Africa/Ndjamena", "Comoros": "Indian/Comoro", "Congo (Brazzaville)": "Africa/Brazzaville", 
        "Congo (Kinshasa)": "Africa/Kinshasa", "Djibouti": "Africa/Djibouti", "Egypt": "Africa/Cairo", 
        "Equatorial Guinea": "Africa/Malabo", "Eritrea": "Africa/Asmara", "Eswatini": "Africa/Mbabane", 
        "Ethiopia": "Africa/Addis_Ababa", "Gabon": "Africa/Libreville", "Gambia": "Africa/Banjul", 
        "Ghana": "Africa/Accra", "Guinea": "Africa/Conakry", "Guinea-Bissau": "Africa/Bissau", 
        "Ivory Coast": "Africa/Abidjan", "Kenya": "Africa/Nairobi", "Lesotho": "Africa/Maseru", 
        "Liberia": "Africa/Monrovia", "Libya": "Africa/Tripoli", "Madagascar": "Indian/Antananarivo", 
        "Malawi": "Africa/Blantyre", "Mali": "Africa/Bamako", "Mauritania": "Africa/Nouakchott", 
        "Mauritius": "Indian/Mauritius", "Morocco": "Africa/Casablanca", "Mozambique": "Africa/Maputo", 
        "Namibia": "Africa/Windhoek", "Niger": "Africa/Niamey", "Nigeria": "Africa/Lagos", 
        "Rwanda": "Africa/Kigali", "Sao Tome & Principe": "Africa/Sao_Tome", "Senegal": "Africa/Dakar", 
        "Seychelles": "Indian/Mahe", "Sierra Leone": "Africa/Freetown", "Somalia": "Africa/Mogadishu", 
        "South Africa": "Africa/Johannesburg", "South Sudan": "Africa/Juba", "Sudan": "Africa/Khartoum", 
        "Tanzania": "Africa/Dar_es_Salaam", "Togo": "Africa/Lome", "Tunisia": "Africa/Tunis", 
        "Uganda": "Africa/Kampala", "Zambia": "Africa/Lusaka", "Zimbabwe": "Africa/Harare"
    },
    americas: {
        "Antigua & Barbuda": "America/Antigua", "Argentina": "America/Argentina/Buenos_Aires", "Bahamas": "America/Nassau", 
        "Barbados": "America/Barbados", "Belize": "America/Belize", "Bolivia": "America/La_Paz", 
        "Brazil (Brasilia)": "America/Sao_Paulo", "Brazil (Manaus)": "America/Manaus", "Canada (EST)": "America/Toronto", 
        "Canada (PST)": "America/Vancouver", "Chile": "America/Santiago", "Colombia": "America/Bogota", 
        "Costa Rica": "America/Costa_Rica", "Cuba": "America/Havana", "Dominica": "America/Dominica", 
        "Dominican Republic": "America/Santo_Domingo", "Ecuador": "America/Guayaquil", "El Salvador": "America/El_Salvador", 
        "Grenada": "America/Grenada", "Guatemala": "America/Guatemala", "Guyana": "America/Guyana", 
        "Haiti": "America/Port-au-Prince", "Honduras": "America/Tegucigalpa", "Jamaica": "America/Jamaica", 
        "Mexico (Central)": "America/Mexico_City", "Mexico (Pacific)": "America/Tijuana", "Nicaragua": "America/Managua", 
        "Panama": "America/Panama", "Paraguay": "America/Asuncion", "Peru": "America/Lima", 
        "St. Kitts & Nevis": "America/St_Kitts", "St. Lucia": "America/St_Lucia", "St. Vincent": "America/St_Vincent", 
        "Suriname": "America/Paramaribo", "Trinidad & Tobago": "America/Port_of_Spain", "USA (EST - New York)": "America/New_York", 
        "USA (CST - Chicago)": "America/Chicago", "USA (MST - Denver)": "America/Denver", "USA (PST - Los Angeles)": "America/Los_Angeles", 
        "USA (AKST - Alaska)": "America/Anchorage", "USA (HST - Hawaii)": "Pacific/Honolulu", "Uruguay": "America/Montevideo", "Venezuela": "America/Caracas"
    },
    asia: {
        "Afghanistan": "Asia/Kabul", "Armenia": "Asia/Yerevan", "Azerbaijan": "Asia/Baku", 
        "Bahrain": "Asia/Bahrain", "Bangladesh": "Asia/Dhaka", "Bhutan": "Asia/Thimphu", 
        "Brunei": "Asia/Brunei", "Cambodia": "Asia/Phnom_Penh", "China": "Asia/Shanghai", 
        "Cyprus": "Asia/Nicosia", "Georgia": "Asia/Tbilisi", "India": "Asia/Kolkata", 
        "Indonesia (Jakarta)": "Asia/Jakarta", "Indonesia (Bali)": "Asia/Makassar", "Iran": "Asia/Tehran", 
        "Iraq": "Asia/Baghdad", "Israel": "Asia/Jerusalem", "Japan": "Asia/Tokyo", 
        "Jordan": "Asia/Amman", "Kazakhstan": "Asia/Almaty", "Kuwait": "Asia/Kuwait", 
        "Kyrgyzstan": "Asia/Bishkek", "Laos": "Asia/Vientiane", "Lebanon": "Asia/Beirut", 
        "Malaysia": "Asia/Kuala_Lumpur", "Maldives": "Indian/Maldives", "Mongolia": "Asia/Ulaanbaatar", 
        "Myanmar": "Asia/Yangon", "Nepal": "Asia/Kathmandu", "North Korea": "Asia/Pyongyang", 
        "Oman": "Asia/Muscat", "Pakistan": "Asia/Karachi", "Palestine": "Asia/Gaza", 
        "Philippines": "Asia/Manila", "Qatar": "Asia/Qatar", "Saudi Arabia": "Asia/Riyadh", 
        "Singapore": "Asia/Singapore", "South Korea": "Asia/Seoul", "Sri Lanka": "Asia/Colombo", 
        "Syria": "Asia/Damascus", "Taiwan": "Asia/Taipei", "Tajikistan": "Asia/Dushanbe", 
        "Thailand": "Asia/Bangkok", "Timor-Leste": "Asia/Dili", "Turkey": "Europe/Istanbul", 
        "Turkmenistan": "Asia/Ashgabat", "UAE": "Asia/Dubai", "Uzbekistan": "Asia/Tashkent", 
        "Vietnam": "Asia/Ho_Chi_Minh", "Yemen": "Asia/Aden"
    },
    europe: {
        "Albania": "Europe/Tirane", "Andorra": "Europe/Andorra", "Austria": "Europe/Vienna", 
        "Belarus": "Europe/Minsk", "Belgium": "Europe/Brussels", "Bosnia & Herzegovina": "Europe/Sarajevo", 
        "Bulgaria": "Europe/Sofia", "Croatia": "Europe/Zagreb", "Czechia": "Europe/Prague", 
        "Denmark": "Europe/Copenhagen", "Estonia": "Europe/Tallinn", "Finland": "Europe/Helsinki", 
        "France": "Europe/Paris", "Germany": "Europe/Berlin", "Greece": "Europe/Athens", 
        "Hungary": "Europe/Budapest", "Iceland": "Atlantic/Reykjavik", "Ireland": "Europe/Dublin", 
        "Italy": "Europe/Rome", "Kosovo": "Europe/Belgrade", "Latvia": "Europe/Riga", 
        "Liechtenstein": "Europe/Vaduz", "Lithuania": "Europe/Vilnius", "Luxembourg": "Europe/Luxembourg", 
        "Malta": "Europe/Malta", "Moldova": "Europe/Chisinau", "Monaco": "Europe/Monaco", 
        "Montenegro": "Europe/Podgorica", "Netherlands": "Europe/Amsterdam", "North Macedonia": "Europe/Skopje", 
        "Norway": "Europe/Oslo", "Poland": "Europe/Warsaw", "Portugal": "Europe/Lisbon", 
        "Romania": "Europe/Bucharest", "Russia (Moscow)": "Europe/Moscow", "Russia (Vladivostok)": "Asia/Vladivostok", 
        "San Marino": "Europe/San_Marino", "Serbia": "Europe/Belgrade", "Slovakia": "Europe/Bratislava", 
        "Slovenia": "Europe/Ljubljana", "Spain": "Europe/Madrid", "Sweden": "Europe/Stockholm", 
        "Switzerland": "Europe/Zurich", "Ukraine": "Europe/Kiev", "United Kingdom": "Europe/London", 
        "Vatican City": "Europe/Vatican"
    },
    oceania: {
        "Australia (Sydney)": "Australia/Sydney", "Australia (Perth)": "Australia/Perth", "Australia (Brisbane)": "Australia/Brisbane", 
        "Fiji": "Pacific/Fiji", "Kiribati": "Pacific/Tarawa", "Marshall Islands": "Pacific/Majuro", 
        "Micronesia": "Pacific/Pohnpei", "Nauru": "Pacific/Nauru", "New Zealand": "Pacific/Auckland", 
        "Palau": "Pacific/Palau", "Papua New Guinea": "Pacific/Port_Moresby", "Samoa": "Pacific/Apia", 
        "Solomon Islands": "Pacific/Guadalcanal", "Tonga": "Pacific/Tongatapu", "Tuvalu": "Pacific/Funafuti", 
        "Vanuatu": "Pacific/Efate"
    }
};


let currentTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
let locModal, nameModal;

function initHeaderSystem() {
    // Initialize Modals if Bootstrap is available
    if (typeof bootstrap !== 'undefined') {
        const locEl = document.getElementById('locationModal');
        if (locEl) locModal = new bootstrap.Modal(locEl);
        
        const nameEl = document.getElementById('usernameModal');
        if (nameEl) nameModal = new bootstrap.Modal(nameEl);
    }

    // 1. Load Data from Storage (Persist)
    let _headerClockInterval = null; 

    chrome.storage.local.get(['userName', 'userLocation', 'userTimezone', 'userProfilePic'], (res) => {
        const name = res.userName || "friend";
        const usernameEl = document.getElementById('username');
        const locationEl = document.getElementById('location-name');
        const profilePicEl = document.getElementById('userProfilePic');

        if (usernameEl) usernameEl.textContent = name;
        if (res.userLocation && locationEl) locationEl.textContent = res.userLocation;
        if (res.userTimezone) currentTz = res.userTimezone;
        if (res.userProfilePic && profilePicEl) profilePicEl.src = res.userProfilePic;

        updateHeaderTime();

        if (_headerClockInterval) clearInterval(_headerClockInterval);
        _headerClockInterval = setInterval(updateHeaderTime, 1000);
    });

    // 2. Event Listeners
    setupProfilePic();
    setupLocationSelector();
    setupNameEditor();
}

function updateHeaderTime() {
    const now = new Date();
    
    const currentHour = parseInt(now.toLocaleString('en-US', { timeZone: currentTz, hour: 'numeric', hour12: false }));
    let greeting = "Good evening";
    if (currentHour < 12) greeting = "Good morning";
    else if (currentHour < 18) greeting = "Good afternoon";
    
    const greetingEl = document.getElementById('greetingText');
    const datetimeEl = document.getElementById('datetime');
    if (greetingEl) greetingEl.textContent = greeting; 

    const options = { 
        timeZone: currentTz,
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
    };
    if (datetimeEl) datetimeEl.textContent = now.toLocaleString('en-US', options); 
}

// --- PROFILE PICTURE ---
function setupProfilePic() {
    const wrapper = document.getElementById('profilePicWrapper');
    const input = document.getElementById('profilePicInput');
    const img = document.getElementById('userProfilePic');

    if (!wrapper || !input) return;

    wrapper.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 100;
                canvas.height = 100;

                const minDim = Math.min(image.width, image.height);
                const sx = (image.width - minDim) / 2;
                const sy = (image.height - minDim) / 2;

                ctx.drawImage(image, sx, sy, minDim, minDim, 0, 0, 100, 100);
                
                const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                
                chrome.storage.local.set({ userProfilePic: dataUrl });
                img.src = dataUrl;
            };
            image.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// --- NAME EDITOR ---
function setupNameEditor() {
    const nameBtn = document.getElementById('username');
    const saveBtn = document.getElementById('saveUsernameBtn');
    const input = document.getElementById('newUsernameInput');

    if (!nameBtn || !saveBtn || !input) return;

    nameBtn.addEventListener('click', () => {
        input.value = nameBtn.textContent;
        if (nameModal) nameModal.show();
    });

    saveBtn.addEventListener('click', () => {
        const newName = input.value.trim();
        if (newName) {
            chrome.storage.local.set({ userName: newName });
            document.getElementById('username').textContent = newName;
            if (nameModal) nameModal.hide();
        }
    });
}

// --- LOCATION SELECTOR ---
function setupLocationSelector() {
    const regionSelect = document.getElementById('locRegionSelect');
    const listContainer = document.getElementById('locCountryList');

    if (!regionSelect || !listContainer) return;

    regionSelect.addEventListener('change', () => {
        const region = regionSelect.value;
        listContainer.innerHTML = "";

        if (!region || !timeZones[region]) {
            listContainer.innerHTML = '<div class="text-center text-muted small py-2 fst-italic">Select a region first</div>';
            return;
        }

        // Populate Countries
        for (const [country, zone] of Object.entries(timeZones[region])) {
            const btn = document.createElement('button');
            btn.className = "btn btn-outline-secondary text-start btn-sm";
            btn.innerHTML = `<div class="fw-bold">${country}</div><div class="small opacity-75" style="font-size:var(--mq-fs-xs)">${zone}</div>`;
            
            btn.addEventListener('click', () => {
                currentTz = zone;
                const locNameDisplay = document.getElementById('location-name');
                if (locNameDisplay) locNameDisplay.textContent = country;
                updateHeaderTime();

                chrome.storage.local.set({ 
                    userLocation: country, 
                    userTimezone: zone 
                });

                if (chrome.storage.sync) {
                    chrome.storage.sync.set({ 
                        marquis_location: country, 
                        marquis_timezone: zone 
                    });
                }

                if (window.showGlobalAlert) window.showGlobalAlert("Location Set", `Timezone updated to ${country}.`, "success");
            });

            listContainer.appendChild(btn);
        }
    });
}

// ====== WORLD TIME SECTION (The standalone tool) ======
function initializeWorldTime() {
    const selector = document.getElementById('regionSelector');
    const display = document.getElementById('timeDisplay');
    const searchInput = document.getElementById('worldTimeSearch');
    const searchContainer = document.getElementById('worldTimeSearchContainer');
    
    let worldInterval;
    let currentSearchQuery = "";

    if (!selector || !display) return;

    // Handle Region Dropdown
    selector.addEventListener('change', () => {
        const region = selector.value;
        if (!region) {
            display.innerHTML = "";
            if (searchContainer) searchContainer.classList.add('d-none');
            if (searchInput) searchInput.value = "";
            currentSearchQuery = "";
            clearInterval(worldInterval);
            return;
        }
        
        // Reveal search box once a region (or ALL) is selected
        if (searchContainer) searchContainer.classList.remove('d-none');
        
        renderWorldClocks(region);
        clearInterval(worldInterval);
        worldInterval = setInterval(() => renderWorldClocks(region), 1000);
    });

    // 🟢 NEW: Handle Search Box Typing
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value.toLowerCase().trim();
            const region = selector.value;
            if (region) {
                renderWorldClocks(region);
            }
        });
    }

    function renderWorldClocks(region) {
        display.innerHTML = "";
        
        let countriesToRender = {};
        
        // Support the new "ALL REGIONS" global search
        if (region === 'all') {
            Object.values(timeZones).forEach(continent => {
                Object.assign(countriesToRender, continent);
            });
        } else {
            countriesToRender = timeZones[region];
        }

        if (!countriesToRender) return;

        let hasMatches = false;

        for (const [country, zone] of Object.entries(countriesToRender)) {
            
            // 🟢 PARTIAL MATCH LOGIC
            if (currentSearchQuery) {
                // Match against the country name OR the timezone string
                if (!country.toLowerCase().includes(currentSearchQuery) && 
                    !zone.toLowerCase().includes(currentSearchQuery)) {
                    continue; // Skip this one if it doesn't match
                }
            }

            hasMatches = true;

            const now = new Date();
            const timeStr = now.toLocaleTimeString('en-US', { 
                timeZone: zone, 
                hour: 'numeric', 
                minute: '2-digit', 
                second: '2-digit',
                hour12: true 
            });
            const dateStr = now.toLocaleDateString('en-US', { 
                timeZone: zone, 
                weekday: 'short', 
                month: 'short', 
                day: 'numeric' 
            });

            const div = document.createElement('div');
            div.className = "d-flex justify-content-between align-items-center p-2 border-bottom border-secondary-subtle";
            div.innerHTML = `
                <div>
                    <div class="fw-bold small text-body">${country}</div>
                    <div class="text-muted" style="font-size: var(--mq-fs-xs);">${dateStr}</div>
                </div>
                <div class="fw-bold font-monospace text-primary">${timeStr}</div>
            `;
            display.appendChild(div);
        }

        // Empty state if search yields no results
        if (!hasMatches && currentSearchQuery) {
            display.innerHTML = `
                <div class="text-center text-muted small py-3 fst-italic bg-body-tertiary rounded border border-dashed">
                    <i class="bi bi-search d-block fs-4 mb-2 opacity-50"></i>
                    No regions found matching "<span class="fw-bold text-body">${MarquisHtml.esc(currentSearchQuery)}</span>"
                </div>`;
        }
    }
}