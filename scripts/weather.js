function initWeather() {
    
    // --- CONFIG ---
    const API_BASE = "https://api.open-meteo.com/v1/forecast";
    const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";
    
    // 🟢 UPDATED: Switched to Windy (RainViewer blocks extensions now)
    const RADAR_BASE = "https://embed.windy.com/embed2.html?lat={lat}&lon={lon}&detailLat={lat}&detailLon={lon}&width=650&height=450&zoom=8&level=surface&overlay=rain&product=ecmwf&menu=&message=&marker=&calendar=now&pressure=&type=map&location=coordinates&detail=&metricWind=default&metricTemp=default&radarRange=-1";
    
    // 🟢 UPDATED: Removed hardcoded city defaults. 
    // We initialize as null so we know to fetch GPS immediately.
    let currentLat = null; 
    let currentLon = null;
    let currentCity = "Detecting...";
    let isFahrenheit = false;

    // UI References
    const container = document.getElementById('weatherContainer');
    const loading = document.getElementById('wxLoading');
    const errorBox = document.getElementById('wxError');
    const tempToggle = document.getElementById('tempUnitToggle');
    const menuSelector = document.getElementById('menuSelector');
    
    const cityInput = document.getElementById('citySearchInput');
    const cityResults = document.getElementById('citySearchResults');
    const searchBtn = document.getElementById('btnSearchCity');
    const btnShowRadar = document.getElementById('btnShowRadar');
    const btnGeoLocate = document.getElementById('btnGeoLocate');
    
    let radarModal;
    if (typeof bootstrap !== 'undefined') {
        const modalEl = document.getElementById('weatherRadarModal');
        if(modalEl) radarModal = new bootstrap.Modal(modalEl);
    }

    // Weather Codes Map
    const weatherCodes = {
        0: { label: "Clear Sky", icon: "bi-sun-fill", color: "text-warning" },
        1: { label: "Mainly Clear", icon: "bi-sun", color: "text-warning" },
        2: { label: "Partly Cloudy", icon: "bi-cloud-sun", color: "text-secondary" },
        3: { label: "Overcast", icon: "bi-clouds-fill", color: "text-secondary" },
        45: { label: "Foggy", icon: "bi-cloud-haze", color: "text-secondary" },
        48: { label: "Rime Fog", icon: "bi-cloud-haze", color: "text-secondary" },
        51: { label: "Light Drizzle", icon: "bi-cloud-drizzle", color: "text-info" },
        53: { label: "Moderate Drizzle", icon: "bi-cloud-drizzle-fill", color: "text-info" },
        55: { label: "Dense Drizzle", icon: "bi-cloud-drizzle-fill", color: "text-info" },
        61: { label: "Slight Rain", icon: "bi-cloud-rain", color: "text-primary" },
        63: { label: "Moderate Rain", icon: "bi-cloud-rain-fill", color: "text-primary" },
        65: { label: "Heavy Rain", icon: "bi-cloud-rain-heavy-fill", color: "text-primary" },
        71: { label: "Light Snow", icon: "bi-snow", color: "text-info" },
        73: { label: "Moderate Snow", icon: "bi-snow2", color: "text-info" },
        75: { label: "Heavy Snow", icon: "bi-snow3", color: "text-info" },
        80: { label: "Light Showers", icon: "bi-cloud-rain", color: "text-primary" },
        81: { label: "Moderate Showers", icon: "bi-cloud-rain-fill", color: "text-primary" },
        82: { label: "Violent Showers", icon: "bi-cloud-rain-heavy-fill", color: "text-primary" },
        95: { label: "Thunderstorm", icon: "bi-cloud-lightning-fill", color: "text-warning" },
        96: { label: "Thunderstorm + Hail", icon: "bi-cloud-lightning-rain-fill", color: "text-warning" },
        99: { label: "Thunderstorm + Heavy Hail", icon: "bi-cloud-lightning-rain-fill", color: "text-danger" }
    };

	// --- INITIALIZATION ---
    let hasLoadedWeather = false; // 🟢 1. Add tracker to prevent spamming

    chrome.storage.local.get(['wxLocation', 'wxUnit'], (res) => {
        if (res.wxUnit === 'F') {
            isFahrenheit = true;
            if(tempToggle) tempToggle.checked = true;
            const tempLabel = document.querySelector('label[for="tempUnitToggle"]');
            if(tempLabel) tempLabel.innerText = "°F";
        } else {
            isFahrenheit = false;
            if(tempToggle) tempToggle.checked = false;
            const tempLabel = document.querySelector('label[for="tempUnitToggle"]');
            if(tempLabel) tempLabel.innerText = "°C";
        }

        if (res.wxLocation) {
            // Just save the coordinates to memory, DO NOT fetch yet
            currentLat = res.wxLocation.lat;
            currentLon = res.wxLocation.lon;
            currentCity = res.wxLocation.name;
        }
        // 🟢 2. Removed detectLocation() from here so it doesn't crash on boot!

        // First open: init runs after the 'change' that opened this section, so the change
        // listener missed it. Checked here, after the saved location is known.
        loadWeatherIfShown();
    });

    // 🟢 3. Lazy Loader: Only fetch when the user actually clicks the Weather tab
    function loadWeatherIfShown() {
        if (menuSelector && menuSelector.value === 'weatherSection' && !hasLoadedWeather) {
            hasLoadedWeather = true; // Mark as loaded so it doesn't re-fetch on every click

            if(!currentLat) detectLocation();
            else fetchWeather();
        }
    }
    if (menuSelector) {
        menuSelector.addEventListener('change', loadWeatherIfShown);
    }

	if(tempToggle) {
        tempToggle.addEventListener('change', (e) => {
            isFahrenheit = e.target.checked;
            chrome.storage.local.set({ wxUnit: isFahrenheit ? 'F' : 'C' });
            
            // 🟢 NEW: Update the label text visually when toggled
            const tempLabel = document.querySelector('label[for="tempUnitToggle"]');
            if(tempLabel) tempLabel.innerText = isFahrenheit ? '°F' : '°C';
            
            fetchWeather();
        });
    }

    // 🟢 NEW: Live Sync for Temperature Units!
    // If the user changes the unit in the Settings Modal, this catches it instantly.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.wxUnit) {
            const newUnit = changes.wxUnit.newValue;
            const newIsF = (newUnit === 'F');
            
            if (isFahrenheit !== newIsF) {
                isFahrenheit = newIsF;
                
                // Update the toggle switch in the Weather Card
                if (tempToggle) tempToggle.checked = isFahrenheit;
                const tempLabel = document.querySelector('label[for="tempUnitToggle"]');
                if (tempLabel) tempLabel.innerText = isFahrenheit ? '°F' : '°C';
                
                // Instantly fetch new data to convert the numbers!
                // (Only if the weather card has been opened and has a location)
                if (currentLat && hasLoadedWeather) {
                    fetchWeather();
                }
            }
        }
    });

    // --- GEOLOCATION HELPER ---
    function detectLocation() {
        if ("geolocation" in navigator) {
            if(loading) loading.classList.remove('d-none');
            if(container) container.classList.add('d-none');
            
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    currentLat = pos.coords.latitude;
                    currentLon = pos.coords.longitude;
                    currentCity = "Current Location"; // API doesn't give city name, generic for now
                    saveLocation(currentLat, currentLon, currentCity);
                    fetchWeather();
                },
                (err) => {
                    console.warn("GPS Denied/Error:", err);
                    // Only use fallback if GPS fails
                    if(!currentLat) {
                        currentLat = 14.5995; currentLon = 120.9842; currentCity = "Manila (Default)";
                    }
                    fetchWeather();
                }
            );
        }
    }

    // --- SEARCH LOGIC ---
    const debounce = (func, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    };

    if (cityInput) {
        cityInput.addEventListener('input', debounce((e) => {
            const query = e.target.value.trim();
            if (query.length >= 3) searchCity(query);
            else if(cityResults) cityResults.classList.add('d-none');
        }, 500));
    }

    if (searchBtn) {
        searchBtn.addEventListener('click', () => {
            const query = cityInput.value.trim();
            if(query) searchCity(query);
        });
    }

	document.addEventListener('click', (e) => {
		if(e.target && e.target.id === 'btnRetryWeather') {
			fetchWeather();
		}
	});

    document.addEventListener('click', (e) => {
        if (cityResults && !cityResults.contains(e.target) && e.target !== cityInput && e.target !== searchBtn) {
            cityResults.classList.add('d-none');
        }
    });

    if(btnGeoLocate) {
        btnGeoLocate.addEventListener('click', detectLocation);
    }

	// --- RADAR LOGIC ---
    if (btnShowRadar) {
        const radarModalEl = document.getElementById('weatherRadarModal');
        const iframe = document.getElementById('radarFrame');
        const loader = document.getElementById('radarLoading');

        // 1. Click just triggers the modal to open
        btnShowRadar.addEventListener('click', () => {
            if(radarModal) radarModal.show();
        });

        if (radarModalEl) {
            // 2. Wait until the modal is FULLY open and visible before loading the map
            radarModalEl.addEventListener('shown.bs.modal', () => {
                const url = RADAR_BASE
                    .replace(/{lat}/g, currentLat)
                    .replace(/{lon}/g, currentLon);
                
                if (iframe) {
                    if (loader) loader.classList.remove('d-none');
                    iframe.src = url;
                    iframe.onload = () => { 
                        if (loader) loader.classList.add('d-none'); 
                    }
                }
            });

            // 3. Clear the iframe when closed (Saves RAM/CPU & guarantees a fresh load next time)
            radarModalEl.addEventListener('hidden.bs.modal', () => {
                if (iframe) {
                    iframe.src = '';
                    if (loader) loader.classList.remove('d-none'); // Reset loader UI
                }
            });
        }
    }

    // --- CORE FUNCTIONS ---
    function searchCity(query) {
        if(!cityResults) return;
        cityResults.innerHTML = '<div class="list-group-item text-muted small bg-body">Searching...</div>';
        cityResults.classList.remove('d-none');

        fetch(`${GEO_API}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`)
            .then(res => res.json())
            .then(data => {
                cityResults.innerHTML = "";
                if (!data.results || data.results.length === 0) {
                    cityResults.innerHTML = '<div class="list-group-item text-muted small bg-body">No domains match your inquiry</div>';
                    return;
                }

                data.results.forEach(city => {
                    const country = city.country || city.country_code || "";
                    const admin1 = city.admin1 || ""; 
                    const locationStr = [admin1, country].filter(Boolean).join(", ");

                    const item = document.createElement('button');
                    item.className = "list-group-item list-group-item-action text-start small bg-body";
                    item.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center">
                            <strong>${MarquisHtml.esc(city.name)}</strong>
                            <small class="text-muted ms-2">${MarquisHtml.esc(locationStr)}</small>
                        </div>
                    `;
                    item.addEventListener('click', () => {
                        currentLat = city.latitude;
                        currentLon = city.longitude;
                        currentCity = city.name;
                        saveLocation(currentLat, currentLon, currentCity);
                        cityInput.value = "";
                        cityResults.classList.add('d-none');
                        fetchWeather();
                    });
                    cityResults.appendChild(item);
                });
            })
            .catch(() => {
                cityResults.innerHTML = '<div class="list-group-item text-danger small bg-body">A tragic error interrupted the search</div>';
            });
    }

    function saveLocation(lat, lon, name) {
        chrome.storage.local.set({ wxLocation: { lat, lon, name } });
    }

    function fetchWeather() {
        if (!loading || !errorBox || !container) return;

        loading.classList.remove('d-none');
        errorBox.classList.add('d-none');
        container.classList.add('d-none');

        const unitParam = isFahrenheit ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "";
        
        const url = `${API_BASE}?latitude=${currentLat}&longitude=${currentLon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,uv_index&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max&air_quality=us_aqi${unitParam}&timezone=auto`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                renderCurrent(data);
                renderHourly(data);
                renderDaily(data);
                renderSmartAdvice(data);
                
                loading.classList.add('d-none');
                container.classList.remove('d-none');
                container.classList.add('animate__fadeIn');
            })
            .catch(err => {
                console.error(err);
                loading.classList.add('d-none');
                errorBox.classList.remove('d-none');
				
				errorBox.innerHTML = `
                    <i class="bi bi-exclamation-triangle fs-1 mb-2"></i>
                    <p class="small fw-bold">Alas, the heavens refuse to share their secrets.</p>
                    <button class="btn btn-sm btn-outline-secondary mt-2" id="btnRetryWeather">Try Again</button>
                `;
            });
    }

    function renderCurrent(data) {
        const cur = data.current;
        const code = weatherCodes[cur.weather_code] || { label: "Unknown", icon: "bi-question-circle", color: "text-secondary" };
        const speedUnit = isFahrenheit ? "mph" : "km/h";

        const cityEl = document.getElementById('wxCity');
        if(cityEl) cityEl.innerText = currentCity;
        
        const dateEl = document.getElementById('wxDate');
        if(dateEl) dateEl.innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        const tempEl = document.getElementById('wxTemp');
        if(tempEl) tempEl.innerText = Math.round(cur.temperature_2m) + "°";
        
        const condEl = document.getElementById('wxCondition');
        if(condEl) condEl.innerText = code.label;
        
        const feelEl = document.getElementById('wxFeelsLike');
        if(feelEl) feelEl.innerText = Math.round(cur.apparent_temperature) + "°";
        
        const iconEl = document.getElementById('wxIcon');
        if(iconEl) iconEl.className = `bi ${code.icon} fs-1 opacity-75`;
        
        // --- VISUAL STORM LOGIC ---
        const card = document.getElementById('wxCurrentCard');
        const alertBadge = document.getElementById('wxStormAlert');
        const isStorm = cur.weather_code >= 95; 

        if(card) {
            if (isStorm) {
                card.style.background = "linear-gradient(135deg, #4c1d95, #1e1b4b)"; 
                if(alertBadge) alertBadge.classList.remove('d-none');
            } else if (cur.is_day === 0) {
                card.style.background = "linear-gradient(135deg, #1e293b, #334155)"; 
                if(alertBadge) alertBadge.classList.add('d-none');
            } else if (cur.weather_code >= 61) {
                card.style.background = "linear-gradient(135deg, #3b82f6, #60a5fa)"; 
                if(alertBadge) alertBadge.classList.add('d-none');
            } else if (cur.weather_code <= 2) {
                card.style.background = "linear-gradient(135deg, #3b82f6, #2563eb)"; 
                if(alertBadge) alertBadge.classList.add('d-none');
            } else {
                card.style.background = "linear-gradient(135deg, #64748b, #94a3b8)"; 
                if(alertBadge) alertBadge.classList.add('d-none');
            }
        }

        const aqi = data.current.us_aqi; 
        const aqiEl = document.getElementById('wxAqi');
        if (aqiEl) {
            if (aqi !== undefined) {
                let color = "success";
                let txt = "Good";
                if(aqi > 50) { color = "warning"; txt = "Moderate"; }
                if(aqi > 100) { color = "danger"; txt = "Unhealthy"; }
                aqiEl.innerText = `AQI: ${aqi} (${txt})`;
                aqiEl.className = `badge bg-${color} bg-opacity-10 text-${color} border border-${color} border-opacity-25 mb-1 d-inline-block`;
            } else if(data.hourly && data.hourly.us_aqi) {
                 const hAqi = data.hourly.us_aqi[0];
                 aqiEl.innerText = `AQI: ${hAqi}`;
            }
        }

        const humEl = document.getElementById('wxHumidity');
        if(humEl) humEl.innerText = cur.relative_humidity_2m + "%";
        
        const windEl = document.getElementById('wxWind');
        if(windEl) windEl.innerText = Math.round(cur.wind_speed_10m) + " " + speedUnit;
        
        if(data.hourly.uv_index) {
            const uvEl = document.getElementById('wxUv');
            if(uvEl) uvEl.innerText = data.hourly.uv_index[0];
        }
        
        const visEl = document.getElementById('wxVis');
        if(visEl) visEl.innerText = "10+ km"; 
    }

    function renderHourly(data) {
        const scroll = document.getElementById('wxHourlyScroll');
        if(!scroll) return;
        scroll.innerHTML = "";
        
        const now = new Date();
        const currentHour = now.getHours();
        
        for(let i = 0; i < 24; i++) {
            const index = i + currentHour; 
            if (index >= data.hourly.time.length) break;

            const timeStr = data.hourly.time[index];
            const temp = Math.round(data.hourly.temperature_2m[index]);
            const code = data.hourly.weather_code[index];
            const rainProb = data.hourly.precipitation_probability[index];
            
            const wInfo = weatherCodes[code] || weatherCodes[0];
            const hourDate = new Date(timeStr);
            const hourLabel = hourDate.getHours() === now.getHours() ? "Now" : hourDate.getHours().toString().padStart(2, '0') + ":00";

            const div = document.createElement('div');
            div.className = "flex-shrink-0 text-center p-2 border rounded bg-body-tertiary";
            div.style.minWidth = "70px";
            
            div.innerHTML = `
                <div class="small fw-bold mb-1">${hourLabel}</div>
                <div class="fs-4 mb-1 ${wInfo.color}"><i class="bi ${wInfo.icon}"></i></div>
                <div class="fw-bold">${temp}°</div>
                <div class="small text-primary" style="font-size:var(--mq-fs-xs);">
                    <i class="bi bi-droplet-fill"></i> ${MarquisHtml.esc(rainProb)}%
                </div>
            `;
            scroll.appendChild(div);
        }
    }

    function renderDaily(data) {
        const list = document.getElementById('wxDailyList');
        if(!list) return;
        list.innerHTML = "";
        
        for(let i = 0; i < 7; i++) { 
            const dateStr = data.daily.time[i];
            const date = new Date(dateStr);
            const dayName = i === 0 ? "Today" : date.toLocaleDateString('en-US', { weekday: 'short' });
            
            const min = Math.round(data.daily.temperature_2m_min[i]);
            const max = Math.round(data.daily.temperature_2m_max[i]);
            const code = data.daily.weather_code[i];
            const rain = data.daily.precipitation_probability_max[i];
            
            const wInfo = weatherCodes[code] || weatherCodes[0];

            const item = document.createElement('li');
            item.className = "list-group-item d-flex justify-content-between align-items-center bg-transparent";
            item.innerHTML = `
                <div class="fw-medium" style="width: 50px;">${dayName}</div>
                <div class="text-center flex-grow-1 text-muted small">
                    <i class="bi bi-droplet-fill text-primary"></i> ${MarquisHtml.esc(rain)}%
                </div>
                <div class="${wInfo.color} fs-5"><i class="bi ${wInfo.icon}"></i></div>
                <div class="fw-bold text-end" style="width: 80px;">
                    ${max}° <span class="text-muted fw-normal small">/ ${min}°</span>
                </div>
            `;
            list.appendChild(item);
        }
    }

    function renderSmartAdvice(data) {
        const adviceEl = document.getElementById('wxSmartAdvice');
        if(!adviceEl) return;

        const rainProbToday = data.daily.precipitation_probability_max[0];
        const uvMax = data.daily.uv_index_max[0];
        const tempMax = data.daily.temperature_2m_max[0];
        const weatherCode = data.current.weather_code;

        let advice = [];

        if (rainProbToday > 50 || (weatherCode >= 51 && weatherCode <= 67) || (weatherCode >= 80)) {
            advice.push("Bring an umbrella");
        }
        if (uvMax > 8) {
            advice.push("Wear sunscreen (High UV)");
        }

        let tempVal = tempMax;
        if(isFahrenheit) tempVal = (tempVal - 32) * 5/9; 

        if (tempVal > 30) {
            advice.push("Stay hydrated!");
            advice.push("Wear light clothes");
        } else if (tempVal < 15) {
            advice.push("Bring a jacket");
        } else {
            advice.push("Great weather for a walk");
        }

        if (weatherCode >= 95) {
            advice = ["Storm warning! Stay indoors if possible."];
        }

        adviceEl.innerText = advice.slice(0, 2).join(" • ");
    }
}

// ─── Lazy-load entry point ────────────────────────────────────────────────────
document.addEventListener('marquis:sectionReady', (e) => {
    if (e.detail.sectionId === 'weatherSection') initWeather();
});

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('weatherContainer')) initWeather();
});