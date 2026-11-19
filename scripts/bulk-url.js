function initBulkUrl() {
    // ---------------------------
     // BUK URL SECTION
     // ---------------------------
 
     let canSaveList = true;

     const defaultSettings = {
         newTab: true,
         newWindow: false,
         groupByHost: false,
         maxTotal: false,
         xNumTotal: "100",
         saveList: false,
         delayBetweenPages: false,
         delayValue: "1",
         cleanOpened: false
     };
 
     function loadSettings(callback) {
         chrome.storage.local.get(["cleanerSettings"], (result) => {
             const settings = result.cleanerSettings || defaultSettings;
             callback(settings);
         });
     }
 
     function saveSettings(settings) {
         chrome.storage.local.set({ cleanerSettings: settings }, () => {
             console.log("✅ Settings saved");
         });
     }
 
     function updateUIWithSettings(settings) {
         // Update radio buttons and checkboxes
         document.getElementById("newTab").checked = settings.newTab;
         document.getElementById("newWindow").checked = settings.newWindow;
         document.getElementById("groupByHost").checked = settings.groupByHost;
         document.getElementById("maxTotal").checked = settings.maxTotal;
         document.getElementById("saveList").checked = settings.saveList;
         document.getElementById("delayBetweenPages").checked = settings.delayBetweenPages;
         
         // Update input values
         document.getElementById("xNumTotal").value = settings.xNumTotal;
         document.getElementById("delayValue").value = settings.delayValue;
     }
 
     function collectSettingsFromUI() {
         return {
             newTab: document.getElementById("newTab").checked,
             newWindow: document.getElementById("newWindow").checked,
             groupByHost: document.getElementById("groupByHost").checked,
             maxTotal: document.getElementById("maxTotal").checked,
             xNumTotal: document.getElementById("xNumTotal").value,
             saveList: document.getElementById("saveList").checked,
             delayBetweenPages: document.getElementById("delayBetweenPages").checked,
             delayValue: document.getElementById("delayValue").value
         };
     }
 
     // Both open buttons hand the raw lines to background.js ('bulk_open_urls'), which validates them
     // (http/https only; bare hosts get http://), applies the limit and opens them. It also owns the delay,
     // so closing the popup no longer stops a one-by-one list.
     function openViaWorker(settings, oneByOne) {
         const urlsText = document.getElementById("urls").value;
         if (!urlsText.trim()) {
             showError(oneByOne ? "Pray, provide at least a single URL for me to process." : "You must enter at least one URL in the box below...");
             return;
         }
         const target = oneByOne
             ? (settings.newWindow ? 'windowPerUrl' : 'tabs')
             : (settings.newWindow ? 'window' : settings.groupByHost ? 'windowPerHost' : 'tabs');
         const delayMs = oneByOne && settings.delayBetweenPages ? (parseInt(settings.delayValue) || 1) * 1000 : 0;
         const max = settings.maxTotal ? (parseInt(settings.xNumTotal) || 100) : 0;
         canSaveList = false;
         chrome.runtime.sendMessage({ action: 'bulk_open_urls', urls: urlsText.split('\n'), target, delayMs, max }).then((res) => {
             if (!res || !res.ok) return showError("A thousand pardons, the opener did not answer.");
             showSkippedUrls(res.skipped || []);
             if (res.opened === 0) return showError("Not a single valid URL was found. How unfortunate.");
             if (settings.cleanOpened) {
                 document.getElementById("urls").value = '';
                 saveList();
             }
         }).catch(() => showError("A thousand pardons, the opener did not answer."));
     }

     function openOneByOne() {
         loadSettings((settings) => openViaWorker(settings, true));
     }
 
     function resetDefaults() {
         updateUIWithSettings(defaultSettings);
         saveSettings(defaultSettings);
     }
 
     function bindEventListeners() {
         // Settings change listeners
         document.querySelectorAll('input[type="checkbox"], input[type="radio"], input[type="number"]').forEach(input => {
             input.addEventListener("change", () => {
                 const updated = collectSettingsFromUI();
                 saveSettings(updated);
             });
         });
 
         // Button listeners
         document.getElementById("closeStudioBtn")?.addEventListener("click", () => window.close());
         document.getElementById("restoreDefaults")?.addEventListener("click", resetDefaults);
         document.getElementById("pasteBtn")?.addEventListener("click", pasteFromClipboard);
         document.getElementById("copyBtn")?.addEventListener("click", copyToClipboard);
         document.getElementById("clearBtn")?.addEventListener("click", clearUrls);
         document.getElementById("importBtn")?.addEventListener("click", importUrls);
         document.getElementById("exportBtn")?.addEventListener("click", exportUrls);
         document.getElementById("extractBtn")?.addEventListener("click", extractUrls);
         document.getElementById("fromTabBtn")?.addEventListener("click", extractHtmlAndDisplay);
         document.getElementById("cleanupBtn")?.addEventListener("click", cleanupUrls);
         document.getElementById("openBtn")?.addEventListener("click", openURLs);
         document.getElementById("openOneByOne")?.addEventListener("click", openOneByOne);
         document.getElementById("copyUrlsBtn")?.addEventListener("click", copyUrlsToClipboard);
 
         // Textarea listener
         document.getElementById("urls")?.addEventListener("input", saveList);
     }
 
     async function pasteFromClipboard() {
         try {
             const text = await navigator.clipboard.readText();
             document.getElementById("urls").value = text;
             saveList();
         } catch (err) {
             showError("Alas, I am unable to pry the contents from your clipboard.");
         }
     }
 
     async function copyToClipboard() {
         try {
             await navigator.clipboard.writeText(document.getElementById("urls").value);
         } catch (err) {
             showError("A thousand pardons, but I failed to scribe that to your clipboard.");
         }
     }
 
     function clearUrls() {
         document.getElementById("urls").value = "";
         saveList();
     }
 
     function copyUrlsToClipboard() {
         copyToClipboard();
     }
 
     function showError(msg) {
         const errorElement = document.getElementById("error");
         if (errorElement) {
             errorElement.innerText = msg;
             errorElement.style.display = "block";
             setTimeout(() => {
                 errorElement.style.display = "none";
             }, 5000);
         }
     }
 
     function saveList() {
         if (!canSaveList) return;
 
         loadSettings((settings) => {
             if (settings.saveList) {
                 const urls = document.getElementById("urls").value;
                 chrome.storage.local.set({ URLs: urls });
             } else {
                 chrome.storage.local.remove("URLs");
             }
         });
     }
 
     function exportUrls() {
         const textarea = document.getElementById("urls");
         const text = textarea.value;
         const blob = new Blob([text], { type: "text/plain" });
         const date = new Date();
         const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}-${String(date.getSeconds()).padStart(2, "0")}`;
         const filename = `bulk_url_export-${timestamp}.txt`;
         const a = document.createElement("a");
         a.href = URL.createObjectURL(blob);
         a.download = filename;
         document.body.appendChild(a);
         a.click();
         document.body.removeChild(a);
         URL.revokeObjectURL(a.href);
     }
 
     function cleanupUrls() {
         extractUrls();
         const textarea = document.getElementById("urls");
         const lines = textarea.value.split("\n");
         const uniqueLines = [...new Set(lines)];
         textarea.value = uniqueLines.join("\n");
         saveList();
     }
 
     function extractUrls() {
         const textarea = document.getElementById("urls");
         const text = textarea.value;
         const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#/%?=~_|!:,.;]*[-A-Z0-9+&@#/%=~_|]|\b[A-Z0-9.-]+\.[A-Z]{2,}[-A-Z0-9+&@#/%=~_|]*\b)/gi;
         const urls = text.match(urlPattern);
 
         if (urls) {
             textarea.value = urls.join("\n");
             const filteredUrls = filterInputListByTLDs(textarea.value, tlds);
             if (filteredUrls.length > 0) {
                 textarea.value = filteredUrls;
             } else {
                 showError("My inspection yielded no valid URLs within your text.");
             }
             textarea.selectionStart = 0;
             textarea.selectionEnd = 0;
         } else {
             showError("I regret to say the text is entirely devoid of URLs.");
         }
         saveList();
     }
 
     function extractHtmlAndDisplay() {
         chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
             if (!tabs[0].url) return;
             if (!tabs[0].url.includes("chrome://") &&
                 !tabs[0].url.includes("chrome-extension://") &&
                 !tabs[0].url.includes("https://chromewebstore.google.com/")) {
                 chrome.scripting.executeScript({
                     target: { tabId: tabs[0].id },
                     function: getPageLinks,
                 }, (injectionResults) => {
                     for (const frameResult of injectionResults) {
                         document.getElementById("urls").value = frameResult.result.join("\n");
                     }
                 });
             } else {
                 showError("I am barred from reading such forbidden system pages, I assure you.");
             }
         });
     }
 
     function getPageLinks() {
         const links = Array.from(document.querySelectorAll("a")).map(link => link.href);
         return [...new Set(links)];
     }
 
     function filterInputListByTLDs(inputList, tldList) {
         const modifiedTlds = tldList.split("\n").map(tld => "." + tld.toLowerCase());
         const inputLines = inputList.split("\n");
         return inputLines.filter(line => {
             const lower = line.toLowerCase();
             return modifiedTlds.some(tld => lower.endsWith(tld) || (lower.includes(tld) && lower[lower.indexOf(tld) + tld.length] === "/"));
         }).join("\n");
     }
 
     function importUrls() {
         const fileInput = document.createElement("input");
         fileInput.type = "file";
         fileInput.accept = ".txt";
 
         fileInput.addEventListener("change", function (event) {
             const file = event.target.files[0];
             if (!file) return;
 
             const reader = new FileReader();
             reader.onload = function (e) {
                 document.getElementById("urls").value = e.target.result;
                 saveList();
             };
             reader.readAsText(file);
         });
 
         fileInput.click();
     }
 
     function openURLs() {
         loadSettings((settings) => openViaWorker(settings, false));
     }
 
     // Skipped lines are user, file or page text: built as text nodes, never as markup.
     function showSkippedUrls(invalidUrls) {
         if (invalidUrls.length > 0) {
             const errorElement = document.getElementById("error");
             const title = document.createElement("strong");
             title.textContent = `Skipped ${invalidUrls.length} invalid URLs:`;
             const list = document.createElement("ul");
             list.style.cssText = "max-height: 100px; overflow-y: auto;";
             list.append(...invalidUrls.map(url => Object.assign(document.createElement("li"), { textContent: url })));
             errorElement.replaceChildren(title, list);
             errorElement.style.display = "block";
         }
     }
 
     loadSettings((settings) => {
         updateUIWithSettings(settings);
         bindEventListeners();
         
         // Load saved URLs if setting is enabled
         if (settings.saveList) {
             chrome.storage.local.get(["URLs"], (result) => {
                 if (result.URLs) {
                     document.getElementById("urls").value = result.URLs;
                 }
             });
         }
     });
 
     //List of all TLDs: Last Updated Mon Jan  1 07:07:01 2024 UTC
     const tlds = `AAA
     AARP
     ABB
     ABBOTT
     ABBVIE
     ABC
     ABLE
     ABOGADO
     ABUDHABI
     AC
     ACADEMY
     ACCENTURE
     ACCOUNTANT
     ACCOUNTANTS
     ACO
     ACTOR
     AD
     ADS
     ADULT
     AE
     AEG
     AERO
     AETNA
     AF
     AFL
     AFRICA
     AG
     AGAKHAN
     AGENCY
     AI
     AIG
     AIRBUS
     AIRFORCE
     AIRTEL
     AKDN
     AL
     ALIBABA
     ALIPAY
     ALLFINANZ
     ALLSTATE
     ALLY
     ALSACE
     ALSTOM
     AM
     AMAZON
     AMERICANEXPRESS
     AMERICANFAMILY
     AMEX
     AMFAM
     AMICA
     AMSTERDAM
     ANALYTICS
     ANDROID
     ANQUAN
     ANZ
     AO
     AOL
     APARTMENTS
     APP
     APPLE
     AQ
     AQUARELLE
     AR
     ARAB
     ARAMCO
     ARCHI
     ARMY
     ARPA
     ART
     ARTE
     AS
     ASDA
     ASIA
     ASSOCIATES
     AT
     ATHLETA
     ATTORNEY
     AU
     AUCTION
     AUDI
     AUDIBLE
     AUDIO
     AUSPOST
     AUTHOR
     AUTO
     AUTOS
     AVIANCA
     AW
     AWS
     AX
     AXA
     AZ
     AZURE
     BA
     BABY
     BAIDU
     BANAMEX
     BANANAREPUBLIC
     BAND
     BANK
     BAR
     BARCELONA
     BARCLAYCARD
     BARCLAYS
     BAREFOOT
     BARGAINS
     BASEBALL
     BASKETBALL
     BAUHAUS
     BAYERN
     BB
     BBC
     BBT
     BBVA
     BCG
     BCN
     BD
     BE
     BEATS
     BEAUTY
     BEER
     BENTLEY
     BERLIN
     BEST
     BESTBUY
     BET
     BF
     BG
     BH
     BHARTI
     BI
     BIBLE
     BID
     BIKE
     BING
     BINGO
     BIO
     BIZ
     BJ
     BLACK
     BLACKFRIDAY
     BLOCKBUSTER
     BLOG
     BLOOMBERG
     BLUE
     BM
     BMS
     BMW
     BN
     BNPPARIBAS
     BO
     BOATS
     BOEHRINGER
     BOFA
     BOM
     BOND
     BOO
     BOOK
     BOOKING
     BOSCH
     BOSTIK
     BOSTON
     BOT
     BOUTIQUE
     BOX
     BR
     BRADESCO
     BRIDGESTONE
     BROADWAY
     BROKER
     BROTHER
     BRUSSELS
     BS
     BT
     BUILD
     BUILDERS
     BUSINESS
     BUY
     BUZZ
     BV
     BW
     BY
     BZ
     BZH
     CA
     CAB
     CAFE
     CAL
     CALL
     CALVINKLEIN
     CAM
     CAMERA
     CAMP
     CANON
     CAPETOWN
     CAPITAL
     CAPITALONE
     CAR
     CARAVAN
     CARDS
     CARE
     CAREER
     CAREERS
     CARS
     CASA
     CASE
     CASH
     CASINO
     CAT
     CATERING
     CATHOLIC
     CBA
     CBN
     CBRE
     CC
     CD
     CENTER
     CEO
     CERN
     CF
     CFA
     CFD
     CG
     CH
     CHANEL
     CHANNEL
     CHARITY
     CHASE
     CHAT
     CHEAP
     CHINTAI
     CHRISTMAS
     CHROME
     CHURCH
     CI
     CIPRIANI
     CIRCLE
     CISCO
     CITADEL
     CITI
     CITIC
     CITY
     CK
     CL
     CLAIMS
     CLEANING
     CLICK
     CLINIC
     CLINIQUE
     CLOTHING
     CLOUD
     CLUB
     CLUBMED
     CM
     CN
     CO
     COACH
     CODES
     COFFEE
     COLLEGE
     COLOGNE
     COM
     COMCAST
     COMMBANK
     COMMUNITY
     COMPANY
     COMPARE
     COMPUTER
     COMSEC
     CONDOS
     CONSTRUCTION
     CONSULTING
     CONTACT
     CONTRACTORS
     COOKING
     COOL
     COOP
     CORSICA
     COUNTRY
     COUPON
     COUPONS
     COURSES
     CPA
     CR
     CREDIT
     CREDITCARD
     CREDITUNION
     CRICKET
     CROWN
     CRS
     CRUISE
     CRUISES
     CU
     CUISINELLA
     CV
     CW
     CX
     CY
     CYMRU
     CYOU
     CZ
     DABUR
     DAD
     DANCE
     DATA
     DATE
     DATING
     DATSUN
     DAY
     DCLK
     DDS
     DE
     DEAL
     DEALER
     DEALS
     DEGREE
     DELIVERY
     DELL
     DELOITTE
     DELTA
     DEMOCRAT
     DENTAL
     DENTIST
     DESI
     DESIGN
     DEV
     DHL
     DIAMONDS
     DIET
     DIGITAL
     DIRECT
     DIRECTORY
     DISCOUNT
     DISCOVER
     DISH
     DIY
     DJ
     DK
     DM
     DNP
     DO
     DOCS
     DOCTOR
     DOG
     DOMAINS
     DOT
     DOWNLOAD
     DRIVE
     DTV
     DUBAI
     DUNLOP
     DUPONT
     DURBAN
     DVAG
     DVR
     DZ
     EARTH
     EAT
     EC
     ECO
     EDEKA
     EDU
     EDUCATION
     EE
     EG
     EMAIL
     EMERCK
     ENERGY
     ENGINEER
     ENGINEERING
     ENTERPRISES
     EPSON
     EQUIPMENT
     ER
     ERICSSON
     ERNI
     ES
     ESQ
     ESTATE
     ET
     EU
     EUROVISION
     EUS
     EVENTS
     EXCHANGE
     EXPERT
     EXPOSED
     EXPRESS
     EXTRASPACE
     FAGE
     FAIL
     FAIRWINDS
     FAITH
     FAMILY
     FAN
     FANS
     FARM
     FARMERS
     FASHION
     FAST
     FEDEX
     FEEDBACK
     FERRARI
     FERRERO
     FI
     FIDELITY
     FIDO
     FILM
     FINAL
     FINANCE
     FINANCIAL
     FIRE
     FIRESTONE
     FIRMDALE
     FISH
     FISHING
     FIT
     FITNESS
     FJ
     FK
     FLICKR
     FLIGHTS
     FLIR
     FLORIST
     FLOWERS
     FLY
     FM
     FO
     FOO
     FOOD
     FOOTBALL
     FORD
     FOREX
     FORSALE
     FORUM
     FOUNDATION
     FOX
     FR
     FREE
     FRESENIUS
     FRL
     FROGANS
     FRONTIER
     FTR
     FUJITSU
     FUN
     FUND
     FURNITURE
     FUTBOL
     FYI
     GA
     GAL
     GALLERY
     GALLO
     GALLUP
     GAME
     GAMES
     GAP
     GARDEN
     GAY
     GB
     GBIZ
     GD
     GDN
     GE
     GEA
     GENT
     GENTING
     GEORGE
     GF
     GG
     GGEE
     GH
     GI
     GIFT
     GIFTS
     GIVES
     GIVING
     GL
     GLASS
     GLE
     GLOBAL
     GLOBO
     GM
     GMAIL
     GMBH
     GMO
     GMX
     GN
     GODADDY
     GOLD
     GOLDPOINT
     GOLF
     GOO
     GOODYEAR
     GOOG
     GOOGLE
     GOP
     GOT
     GOV
     GP
     GQ
     GR
     GRAINGER
     GRAPHICS
     GRATIS
     GREEN
     GRIPE
     GROCERY
     GROUP
     GS
     GT
     GU
     GUARDIAN
     GUCCI
     GUGE
     GUIDE
     GUITARS
     GURU
     GW
     GY
     HAIR
     HAMBURG
     HANGOUT
     HAUS
     HBO
     HDFC
     HDFCBANK
     HEALTH
     HEALTHCARE
     HELP
     HELSINKI
     HERE
     HERMES
     HIPHOP
     HISAMITSU
     HITACHI
     HIV
     HK
     HKT
     HM
     HN
     HOCKEY
     HOLDINGS
     HOLIDAY
     HOMEDEPOT
     HOMEGOODS
     HOMES
     HOMESENSE
     HONDA
     HORSE
     HOSPITAL
     HOST
     HOSTING
     HOT
     HOTELS
     HOTMAIL
     HOUSE
     HOW
     HR
     HSBC
     HT
     HU
     HUGHES
     HYATT
     HYUNDAI
     IBM
     ICBC
     ICE
     ICU
     ID
     IE
     IEEE
     IFM
     IKANO
     IL
     IM
     IMAMAT
     IMDB
     IMMO
     IMMOBILIEN
     IN
     INC
     INDUSTRIES
     INFINITI
     INFO
     ING
     INK
     INSTITUTE
     INSURANCE
     INSURE
     INT
     INTERNATIONAL
     INTUIT
     INVESTMENTS
     IO
     IPIRANGA
     IQ
     IR
     IRISH
     IS
     ISMAILI
     IST
     ISTANBUL
     IT
     ITAU
     ITV
     JAGUAR
     JAVA
     JCB
     JE
     JEEP
     JETZT
     JEWELRY
     JIO
     JLL
     JM
     JMP
     JNJ
     JO
     JOBS
     JOBURG
     JOT
     JOY
     JP
     JPMORGAN
     JPRS
     JUEGOS
     JUNIPER
     KAUFEN
     KDDI
     KE
     KERRYHOTELS
     KERRYLOGISTICS
     KERRYPROPERTIES
     KFH
     KG
     KH
     KI
     KIA
     KIDS
     KIM
     KINDLE
     KITCHEN
     KIWI
     KM
     KN
     KOELN
     KOMATSU
     KOSHER
     KP
     KPMG
     KPN
     KR
     KRD
     KRED
     KUOKGROUP
     KW
     KY
     KYOTO
     KZ
     LA
     LACAIXA
     LAMBORGHINI
     LAMER
     LANCASTER
     LAND
     LANDROVER
     LANXESS
     LASALLE
     LAT
     LATINO
     LATROBE
     LAW
     LAWYER
     LB
     LC
     LDS
     LEASE
     LECLERC
     LEFRAK
     LEGAL
     LEGO
     LEXUS
     LGBT
     LI
     LIDL
     LIFE
     LIFEINSURANCE
     LIFESTYLE
     LIGHTING
     LIKE
     LILLY
     LIMITED
     LIMO
     LINCOLN
     LINK
     LIPSY
     LIVE
     LIVING
     LK
     LLC
     LLP
     LOAN
     LOANS
     LOCKER
     LOCUS
     LOL
     LONDON
     LOTTE
     LOTTO
     LOVE
     LPL
     LPLFINANCIAL
     LR
     LS
     LT
     LTD
     LTDA
     LU
     LUNDBECK
     LUXE
     LUXURY
     LV
     LY
     MA
     MADRID
     MAIF
     MAISON
     MAKEUP
     MAN
     MANAGEMENT
     MANGO
     MAP
     MARKET
     MARKETING
     MARKETS
     MARRIOTT
     MARSHALLS
     MATTEL
     MBA
     MC
     MCKINSEY
     MD
     ME
     MED
     MEDIA
     MEET
     MELBOURNE
     MEME
     MEMORIAL
     MEN
     MENU
     MERCKMSD
     MG
     MH
     MIAMI
     MICROSOFT
     MIL
     MINI
     MINT
     MIT
     MITSUBISHI
     MK
     ML
     MLB
     MLS
     MM
     MMA
     MN
     MO
     MOBI
     MOBILE
     MODA
     MOE
     MOI
     MOM
     MONASH
     MONEY
     MONSTER
     MORMON
     MORTGAGE
     MOSCOW
     MOTO
     MOTORCYCLES
     MOV
     MOVIE
     MP
     MQ
     MR
     MS
     MSD
     MT
     MTN
     MTR
     MU
     MUSEUM
     MUSIC
     MV
     MW
     MX
     MY
     MZ
     NA
     NAB
     NAGOYA
     NAME
     NATURA
     NAVY
     NBA
     NC
     NE
     NEC
     NET
     NETBANK
     NETFLIX
     NETWORK
     NEUSTAR
     NEW
     NEWS
     NEXT
     NEXTDIRECT
     NEXUS
     NF
     NFL
     NG
     NGO
     NHK
     NI
     NICO
     NIKE
     NIKON
     NINJA
     NISSAN
     NISSAY
     NL
     NO
     NOKIA
     NORTON
     NOW
     NOWRUZ
     NOWTV
     NP
     NR
     NRA
     NRW
     NTT
     NU
     NYC
     NZ
     OBI
     OBSERVER
     OFFICE
     OKINAWA
     OLAYAN
     OLAYANGROUP
     OLDNAVY
     OLLO
     OM
     OMEGA
     ONE
     ONG
     ONL
     ONLINE
     OOO
     OPEN
     ORACLE
     ORANGE
     ORG
     ORGANIC
     ORIGINS
     OSAKA
     OTSUKA
     OTT
     OVH
     PA
     PAGE
     PANASONIC
     PARIS
     PARS
     PARTNERS
     PARTS
     PARTY
     PAY
     PCCW
     PE
     PET
     PF
     PFIZER
     PG
     PH
     PHARMACY
     PHD
     PHILIPS
     PHONE
     PHOTO
     PHOTOGRAPHY
     PHOTOS
     PHYSIO
     PICS
     PICTET
     PICTURES
     PID
     PIN
     PING
     PINK
     PIONEER
     PIZZA
     PK
     PL
     PLACE
     PLAY
     PLAYSTATION
     PLUMBING
     PLUS
     PM
     PN
     PNC
     POHL
     POKER
     POLITIE
     PORN
     POST
     PR
     PRAMERICA
     PRAXI
     PRESS
     PRIME
     PRO
     PROD
     PRODUCTIONS
     PROF
     PROGRESSIVE
     PROMO
     PROPERTIES
     PROPERTY
     PROTECTION
     PRU
     PRUDENTIAL
     PS
     PT
     PUB
     PW
     PWC
     PY
     QA
     QPON
     QUEBEC
     QUEST
     RACING
     RADIO
     RE
     READ
     REALESTATE
     REALTOR
     REALTY
     RECIPES
     RED
     REDSTONE
     REDUMBRELLA
     REHAB
     REISE
     REISEN
     REIT
     RELIANCE
     REN
     RENT
     RENTALS
     REPAIR
     REPORT
     REPUBLICAN
     REST
     RESTAURANT
     REVIEW
     REVIEWS
     REXROTH
     RICH
     RICHARDLI
     RICOH
     RIL
     RIO
     RIP
     RO
     ROCKS
     RODEO
     ROGERS
     ROOM
     RS
     RSVP
     RU
     RUGBY
     RUHR
     RUN
     RW
     RWE
     RYUKYU
     SA
     SAARLAND
     SAFE
     SAFETY
     SAKURA
     SALE
     SALON
     SAMSCLUB
     SAMSUNG
     SANDVIK
     SANDVIKCOROMANT
     SANOFI
     SAP
     SARL
     SAS
     SAVE
     SAXO
     SB
     SBI
     SBS
     SC
     SCB
     SCHAEFFLER
     SCHMIDT
     SCHOLARSHIPS
     SCHOOL
     SCHULE
     SCHWARZ
     SCIENCE
     SCOT
     SD
     SE
     SEARCH
     SEAT
     SECURE
     SECURITY
     SEEK
     SELECT
     SENER
     SERVICES
     SEVEN
     SEW
     SEX
     SEXY
     SFR
     SG
     SH
     SHANGRILA
     SHARP
     SHAW
     SHELL
     SHIA
     SHIKSHA
     SHOES
     SHOP
     SHOPPING
     SHOUJI
     SHOW
     SI
     SILK
     SINA
     SINGLES
     SITE
     SJ
     SK
     SKI
     SKIN
     SKY
     SKYPE
     SL
     SLING
     SM
     SMART
     SMILE
     SN
     SNCF
     SO
     SOCCER
     SOCIAL
     SOFTBANK
     SOFTWARE
     SOHU
     SOLAR
     SOLUTIONS
     SONG
     SONY
     SOY
     SPA
     SPACE
     SPORT
     SPOT
     SR
     SRL
     SS
     ST
     STADA
     STAPLES
     STAR
     STATEBANK
     STATEFARM
     STC
     STCGROUP
     STOCKHOLM
     STORAGE
     STORE
     STREAM
     STUDIO
     STUDY
     STYLE
     SU
     SUCKS
     SUPPLIES
     SUPPLY
     SUPPORT
     SURF
     SURGERY
     SUZUKI
     SV
     SWATCH
     SWISS
     SX
     SY
     SYDNEY
     SYSTEMS
     SZ
     TAB
     TAIPEI
     TALK
     TAOBAO
     TARGET
     TATAMOTORS
     TATAR
     TATTOO
     TAX
     TAXI
     TC
     TCI
     TD
     TDK
     TEAM
     TECH
     TECHNOLOGY
     TEL
     TEMASEK
     TENNIS
     TEVA
     TF
     TG
     TH
     THD
     THEATER
     THEATRE
     TIAA
     TICKETS
     TIENDA
     TIPS
     TIRES
     TIROL
     TJ
     TJMAXX
     TJX
     TK
     TKMAXX
     TL
     TM
     TMALL
     TN
     TO
     TODAY
     TOKYO
     TOOLS
     TOP
     TORAY
     TOSHIBA
     TOTAL
     TOURS
     TOWN
     TOYOTA
     TOYS
     TR
     TRADE
     TRADING
     TRAINING
     TRAVEL
     TRAVELERS
     TRAVELERSINSURANCE
     TRUST
     TRV
     TT
     TUBE
     TUI
     TUNES
     TUSHU
     TV
     TVS
     TW
     TZ
     UA
     UBANK
     UBS
     UG
     UK
     UNICOM
     UNIVERSITY
     UNO
     UOL
     UPS
     US
     UY
     UZ
     VA
     VACATIONS
     VANA
     VANGUARD
     VC
     VE
     VEGAS
     VENTURES
     VERISIGN
     VERSICHERUNG
     VET
     VG
     VI
     VIAJES
     VIDEO
     VIG
     VIKING
     VILLAS
     VIN
     VIP
     VIRGIN
     VISA
     VISION
     VIVA
     VIVO
     VLAANDEREN
     VN
     VODKA
     VOLVO
     VOTE
     VOTING
     VOTO
     VOYAGE
     VU
     WALES
     WALMART
     WALTER
     WANG
     WANGGOU
     WATCH
     WATCHES
     WEATHER
     WEATHERCHANNEL
     WEBCAM
     WEBER
     WEBSITE
     WED
     WEDDING
     WEIBO
     WEIR
     WF
     WHOSWHO
     WIEN
     WIKI
     WILLIAMHILL
     WIN
     WINDOWS
     WINE
     WINNERS
     WME
     WOLTERSKLUWER
     WOODSIDE
     WORK
     WORKS
     WORLD
     WOW
     WS
     WTC
     WTF
     XBOX
     XEROX
     XFINITY
     XIHUAN
     XIN
     XN--11B4C3D
     XN--1CK2E1B
     XN--1QQW23A
     XN--2SCRJ9C
     XN--30RR7Y
     XN--3BST00M
     XN--3DS443G
     XN--3E0B707E
     XN--3HCRJ9C
     XN--3PXU8K
     XN--42C2D9A
     XN--45BR5CYL
     XN--45BRJ9C
     XN--45Q11C
     XN--4DBRK0CE
     XN--4GBRIM
     XN--54B7FTA0CC
     XN--55QW42G
     XN--55QX5D
     XN--5SU34J936BGSG
     XN--5TZM5G
     XN--6FRZ82G
     XN--6QQ986B3XL
     XN--80ADXHKS
     XN--80AO21A
     XN--80AQECDR1A
     XN--80ASEHDB
     XN--80ASWG
     XN--8Y0A063A
     XN--90A3AC
     XN--90AE
     XN--90AIS
     XN--9DBQ2A
     XN--9ET52U
     XN--9KRT00A
     XN--B4W605FERD
     XN--BCK1B9A5DRE4C
     XN--C1AVG
     XN--C2BR7G
     XN--CCK2B3B
     XN--CCKWCXETD
     XN--CG4BKI
     XN--CLCHC0EA0B2G2A9GCD
     XN--CZR694B
     XN--CZRS0T
     XN--CZRU2D
     XN--D1ACJ3B
     XN--D1ALF
     XN--E1A4C
     XN--ECKVDTC9D
     XN--EFVY88H
     XN--FCT429K
     XN--FHBEI
     XN--FIQ228C5HS
     XN--FIQ64B
     XN--FIQS8S
     XN--FIQZ9S
     XN--FJQ720A
     XN--FLW351E
     XN--FPCRJ9C3D
     XN--FZC2C9E2C
     XN--FZYS8D69UVGM
     XN--G2XX48C
     XN--GCKR3F0F
     XN--GECRJ9C
     XN--GK3AT1E
     XN--H2BREG3EVE
     XN--H2BRJ9C
     XN--H2BRJ9C8C
     XN--HXT814E
     XN--I1B6B1A6A2E
     XN--IMR513N
     XN--IO0A7I
     XN--J1AEF
     XN--J1AMH
     XN--J6W193G
     XN--JLQ480N2RG
     XN--JVR189M
     XN--KCRX77D1X4A
     XN--KPRW13D
     XN--KPRY57D
     XN--KPUT3I
     XN--L1ACC
     XN--LGBBAT1AD8J
     XN--MGB9AWBF
     XN--MGBA3A3EJT
     XN--MGBA3A4F16A
     XN--MGBA7C0BBN0A
     XN--MGBAAM7A8H
     XN--MGBAB2BD
     XN--MGBAH1A3HJKRD
     XN--MGBAI9AZGQP6J
     XN--MGBAYH7GPA
     XN--MGBBH1A
     XN--MGBBH1A71E
     XN--MGBC0A9AZCG
     XN--MGBCA7DZDO
     XN--MGBCPQ6GPA1A
     XN--MGBERP4A5D4AR
     XN--MGBGU82A
     XN--MGBI4ECEXP
     XN--MGBPL2FH
     XN--MGBT3DHD
     XN--MGBTX2B
     XN--MGBX4CD0AB
     XN--MIX891F
     XN--MK1BU44C
     XN--MXTQ1M
     XN--NGBC5AZD
     XN--NGBE9E0A
     XN--NGBRX
     XN--NODE
     XN--NQV7F
     XN--NQV7FS00EMA
     XN--NYQY26A
     XN--O3CW4H
     XN--OGBPF8FL
     XN--OTU796D
     XN--P1ACF
     XN--P1AI
     XN--PGBS0DH
     XN--PSSY2U
     XN--Q7CE6A
     XN--Q9JYB4C
     XN--QCKA1PMC
     XN--QXA6A
     XN--QXAM
     XN--RHQV96G
     XN--ROVU88B
     XN--RVC1E0AM3E
     XN--S9BRJ9C
     XN--SES554G
     XN--T60B56A
     XN--TCKWE
     XN--TIQ49XQYJ
     XN--UNUP4Y
     XN--VERMGENSBERATER-CTB
     XN--VERMGENSBERATUNG-PWB
     XN--VHQUV
     XN--VUQ861B
     XN--W4R85EL8FHU5DNRA
     XN--W4RS40L
     XN--WGBH1C
     XN--WGBL6A
     XN--XHQ521B
     XN--XKC2AL3HYE2A
     XN--XKC2DL3A5EE0H
     XN--Y9A3AQ
     XN--YFRO4I67O
     XN--YGBI2AMMX
     XN--ZFR164B
     XXX
     XYZ
     YACHTS
     YAHOO
     YAMAXUN
     YANDEX
     YE
     YODOBASHI
     YOGA
     YOKOHAMA
     YOU
     YOUTUBE
     YT
     YUN
     ZA
     ZAPPOS
     ZARA
     ZERO
     ZIP
     ZM
     ZONE
     ZUERICH
     ZW`;
 
     // ---------------------------
     // END BUK URL SECTION
     // ---------------------------
 }
 
 // ─── Lazy-load entry point ────────────────────────────────────────────────────
 document.addEventListener('marquis:sectionReady', (e) => {
     if (e.detail.sectionId === 'buoSection') initBulkUrl();
 });
 
 document.addEventListener('DOMContentLoaded', () => {
     if (document.getElementById('newTab')) initBulkUrl();
 });