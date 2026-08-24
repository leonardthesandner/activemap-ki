// Globale Variablen
let map;
let apiKey = '';
let openaiApiKey = '';
let techniker = [];
let kunden = [];
let isochroneLayers = [];
let technikerMarkers = [];
let kundenMarkers = [];
let isochroneGeoJSON = []; // Speichert GeoJSON der Isochronen für Coverage-Check
let cogCandidates = []; // Letzte COG-Kandidaten für Button-Aktion
let aiAnonEnabled = false;        // Anonymisierung aktiv?
let anonMap = {};                 // { realName -> pseudonym }
let anonMapReverse = {};          // { pseudonym -> realName }
let currentEditTechId = null; // Für Skills-Editing
let deviceWeights = {}; // Format: { "Pro": 3.0, "Pure": 2.5, "P612": 1.5 } - Default: 1.0

// ===== ZUKUNFTSMODUS (Simulations-Sandbox) =====
let futureTechniker = [];          // Sandbox-Techniker (echt kopierte + simulierte)
let futureKunden = [];             // Sandbox-Kunden (echt kopierte + simulierte)
let futureTechnikerMarkers = [];   // Kartenmarker der Sandbox-Techniker
let futureKundenMarkers = [];      // Kartenmarker der Sandbox-Kunden
let futureIsochroneGeoJSON = [];   // Isochronen-Cache der Sandbox
let futureIsochroneLayers = [];    // Isochronen-Kartenlayer der Sandbox
let futureScenarioId = null;       // Aktuell geladenes Szenario (IndexedDB-ID) oder null = unbenannter Entwurf
let futureScenarioName = null;
let futureRealCoveragePercent = null; // Echte Abdeckung zum Zeitpunkt des Betretens der Sandbox (für KPI-Vergleich)
const FUTURE_SCENARIO_INDEX_ID = 'future_scenarios_index';

// Dienstplan-Variablen
let schedule = {}; // Format: { technikerId: { 'YYYY-MM-DD': 'status' } }
let selectedDate = null; // Aktuell ausgewähltes Datum für Tagesansicht
let calendarView = 'month'; // 'month' oder 'week'
let currentCalendarMonth = new Date(2025, 10, 1); // Start: November 2025

// Installation Planning Variablen
let installationPlanningMode = false; // Ob wir im Planungsmodus sind
let selectedProjectLeader = null; // Ausgewählter Projektleiter
let selectedProjectSize = null; // S, M, XL
let plannedInstallationDays = []; // Array der geplanten Installations-Tage

// Installation Analysis Variablen
let installationAnalysisMode = false; // Ob wir im Analyse-Modus sind
let analysisStartDate = null; // Ausgewählter Starttag für Analyse
let analysisEndDate = null; // Ausgewählter Endtag für Analyse
let analysisProjectLeader = null; // Projektleiter für Analyse

// Überlastungsgrenze für Techniker (Gewichtseinheiten)
let overloadThreshold = 80; // Default: 80 Gewichtseinheiten
let penaltyWeight = 0.01; // Default: 0.01 für Effizienz-Score Berechnung

// ===== PERFORMANCE OPTIMIERUNGEN (Phase 1) =====
// Marker Cluster Group für Kunden
let kundenClusterGroup = null;

// Performance Monitoring
const performanceMetrics = {
    coverageChecks: [],
    syncOperations: [],
    mapUpdates: []
};

// Debounce-Helper für verzögerte Funktionsausführung
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Performance-Logging
function logPerformance(operation, duration) {
    if (!performanceMetrics[operation]) {
        performanceMetrics[operation] = [];
    }
    
    performanceMetrics[operation].push({
        timestamp: new Date(),
        duration: duration
    });
    
    // Keep only last 20 measurements
    if (performanceMetrics[operation].length > 20) {
        performanceMetrics[operation].shift();
    }
    
    // Warn if slow
    if (duration > 5000) {
        console.warn(`⚠️ SLOW OPERATION: ${operation} took ${(duration/1000).toFixed(1)}s`);
    }
    
    // Log average
    if (performanceMetrics[operation].length >= 10) {
        const avg = performanceMetrics[operation]
            .reduce((sum, m) => sum + m.duration, 0) / performanceMetrics[operation].length;
        
        if (avg > 3000) {
            console.warn(`⚠️ AVERAGE SLOW: ${operation} averages ${(avg/1000).toFixed(1)}s`);
        }
    }
}

// Global Loading Indicator
function showGlobalLoader(message = 'Lädt...') {
    let loader = document.getElementById('globalLoader');
    
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'globalLoader';
        loader.innerHTML = `
            <div class="loader-backdrop">
                <div class="loader-content">
                    <div class="spinner"></div>
                    <p id="loaderMessage">${message}</p>
                </div>
            </div>
        `;
        document.body.appendChild(loader);
    } else {
        document.getElementById('loaderMessage').textContent = message;
        loader.style.display = 'block';
    }
}

function hideGlobalLoader() {
    const loader = document.getElementById('globalLoader');
    if (loader) {
        loader.style.display = 'none';
    }
}

// ===== INDEXEDDB SETUP (für große Datenmengen) =====
let db = null;
const DB_NAME = 'TechnikerAppDB';
const DB_VERSION = 3; // Erhöht für neue deviceAssignments Struktur
const STORE_NAME = 'appData';

// App-Modus: 'calendar' oder 'strategy'
let appMode = 'calendar';

// IndexedDB initialisieren
function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = (event) => {
            console.error('❌ IndexedDB Fehler:', event.target.error);
            reject(event.target.error);
        };
        
        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('✅ IndexedDB geöffnet');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            
            // Object Store erstellen falls nicht vorhanden
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                console.log('📦 IndexedDB Store erstellt');
            }
        };
    });
}

// Daten in IndexedDB speichern
function saveToIndexedDB() {
    if (!db) {
        console.warn('⚠️ IndexedDB nicht bereit, speichere später...');
        return Promise.resolve();
    }
    
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // Daten als einzelnes Objekt speichern
            const data = {
                id: 'main_data',
                techniker: techniker,
                kunden: kunden,
                isochroneData: isochroneGeoJSON,
                schedule: schedule,
                deviceWeights: deviceWeights,
                overloadThreshold: overloadThreshold,
                penaltyWeight: penaltyWeight,
                lastSaved: new Date().toISOString()
            };
            
            const request = store.put(data);
            
            request.onsuccess = () => {
                console.log('💾 Daten in IndexedDB gespeichert');
                resolve();
            };
            
            request.onerror = (event) => {
                console.error('❌ Fehler beim Speichern:', event.target.error);
                reject(event.target.error);
            };
        } catch (error) {
            console.error('❌ IndexedDB Speicherfehler:', error);
            reject(error);
        }
    });
}

// Daten aus IndexedDB laden
function loadFromIndexedDB() {
    if (!db) {
        console.warn('⚠️ IndexedDB nicht bereit');
        return Promise.resolve(null);
    }
    
    return new Promise((resolve, reject) => {
        try {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get('main_data');
            
            request.onsuccess = (event) => {
                const data = event.target.result;
                if (data) {
                    console.log('📂 Daten aus IndexedDB geladen');
                    resolve(data);
                } else {
                    console.log('📂 Keine Daten in IndexedDB gefunden');
                    resolve(null);
                }
            };
            
            request.onerror = (event) => {
                console.error('❌ Fehler beim Laden:', event.target.error);
                reject(event.target.error);
            };
        } catch (error) {
            console.error('❌ IndexedDB Ladefehler:', error);
            reject(error);
        }
    });
}

// Wrapper für synchronen Aufruf (fire and forget) mit Debouncing
let saveTimeout = null;
let isSaving = false;

function saveToLocalStorage() {
    // Debounce: Warte 100ms bevor gespeichert wird
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
        if (isSaving) {
            // Wenn noch gespeichert wird, später erneut versuchen
            saveToLocalStorage();
            return;
        }
        
        isSaving = true;
        saveToIndexedDB()
            .then(() => {
                isSaving = false;
            })
            .catch(err => {
                console.error('Speicherfehler:', err);
                isSaving = false;
            });
    }, 100);
}

// Sofortiges Speichern (für kritische Operationen)
async function saveToLocalStorageImmediate() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveTimeout = null;
    }
    await saveToIndexedDB();
}

// Status-Typen für Dienstplan
const STATUS_TYPES = {
    ZR: { label: 'Bereitschaft', color: '#fd7e14', textColor: '#fff' }, // Orange
    X: { label: 'Abwesend', color: '#dc3545', textColor: '#fff' }, // Rot
    I: { label: 'Installation', color: '#6f42c1', textColor: '#fff' }, // Lila
    W: { label: 'Wartung', color: '#ffc107', textColor: '#000' }, // Gelb
    K: { label: 'Krank', color: '#20c997', textColor: '#fff' }, // Türkis-Grün
    U: { label: 'Urlaub', color: '#17a2b8', textColor: '#fff' } // Türkis-Grün
};

// Filter-State
let activeSkillFilters = new Set(); // Welche Skills sind aktiv
let activeInstrumentLineFilters = new Set(); // Welche InstrumentLines sind aktiv
let activeRSLFilters = new Set(); // Welche RSLs sind aktiv

// ===== ASSIGNMENT SYSTEM =====
let assignmentMode = false; // Ob Assignment-Modus aktiv ist
let selectedTechnicianForAssignment = null; // Aktuell ausgewählter Techniker für Zuweisungen
let assignmentLines = []; // Array von Leaflet-Polylines für Zuweisungen
let assignmentFilter = 'all'; // 'all', 'assigned', 'unassigned', 'partial', 'assignedToSelected'

// Datenstruktur für Gerät-basierte Zuweisung (individuelle Geräte-Instanzen):
// kunde.deviceAssignments = { "Pro_0": techId, "Pro_1": techId, "X-Plore_0": techId, ... }
// Format: deviceType_index

// Initialisierung beim Laden der Seite
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 App wird initialisiert...');
    
    // IndexedDB initialisieren
    try {
        await initIndexedDB();
        console.log('✅ IndexedDB bereit');
    } catch (error) {
        console.error('❌ IndexedDB Initialisierung fehlgeschlagen:', error);
        alert('⚠️ Fehler bei der Datenbank-Initialisierung. Die App funktioniert möglicherweise nicht korrekt.');
    }
    
    initMap();
    await loadFromLocalStorageAsync(); // Neue async Funktion
    setupEventListeners();
    initializeSchedule();
    
    // Kalender auf heute setzen
    selectedDate = new Date();
    selectedDate.setHours(0, 0, 0, 0); // Zeit auf Mitternacht setzen
    
    updateMonthLabel();
    renderScheduleCalendar();
    updateMapForSelectedDate(); // Karte für heute aktualisieren
    updateUI();
    
    // Hilfe-Panel Resize initialisieren
    initHelpPanelResize();
    
    // Hilfe-Sections initialisieren (ALLE standardmäßig zuklappen)
    const helpSections = ['helpStart', 'helpExcelTech', 'helpExcelKunden', 'helpExcelCalendar', 
                         'helpModes', 'helpAnalysis', 'helpCalendar', 'helpTips'];
    helpSections.forEach(sectionId => {
        const content = document.getElementById(sectionId);
        if (content && !content.classList.contains('collapsed')) {
            content.classList.add('collapsed');
            const header = content.previousElementSibling;
            const toggle = header ? header.querySelector('.help-toggle') : null;
            if (toggle && !toggle.classList.contains('collapsed')) {
                toggle.classList.add('collapsed');
            }
        }
    });
    
    console.log('✅ App initialisiert - Kalender zeigt heute');
});

// Karte initialisieren
function initMap() {
    // ✅ PERFORMANCE: Canvas Renderer statt SVG für bessere Performance bei vielen Polygonen
    map = L.map('map', {
        preferCanvas: true,
        renderer: L.canvas({ padding: 0.5 })
    }).setView([51.1657, 10.4515], 6);
    
    // OpenStreetMap Tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Click Event für Koordinaten
    map.on('click', function(e) {
        console.log(`Koordinaten: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`);
    });
}

// Event Listeners einrichten
function setupEventListeners() {
    // API Key
    document.getElementById('saveApiKey').addEventListener('click', saveApiKey);
    document.getElementById('testApi').addEventListener('click', testApiConnection);
    
    // Techniker
    document.getElementById('addTechniker').addEventListener('click', () => openModal('techniker'));
    document.getElementById('technikerForm').addEventListener('submit', addTechniker);
    
    // Kunden
    document.getElementById('addKunde').addEventListener('click', () => openModal('kunde'));
    document.getElementById('kundeForm').addEventListener('submit', addKunde);
    
    // Skills bearbeiten
    document.getElementById('editSkillsForm').addEventListener('submit', saveEditedSkills);
    
    // Analyse
    document.getElementById('loadIsochrones').addEventListener('click', loadIsochrones);
    document.getElementById('analyzeButton').addEventListener('click', performAnalysis);
    
    // Export/Import
    document.getElementById('exportData').addEventListener('click', exportData);
    document.getElementById('importData').addEventListener('click', () => {
        document.getElementById('fileInput').click();
    });
    document.getElementById('fileInput').addEventListener('change', importData);
    
    // Alle Daten löschen
    document.getElementById('deleteAllData').addEventListener('click', deleteAllData);
    
    // Excel Import
    document.getElementById('importCalendarExcel').addEventListener('click', () => {
        document.getElementById('calendarExcelInput').click();
    });
    document.getElementById('calendarExcelInput').addEventListener('change', importCalendarExcel);
    
    document.getElementById('importTechnikerExcel').addEventListener('click', () => {
        document.getElementById('techExcelInput').click();
    });
    document.getElementById('techExcelInput').addEventListener('change', importTechnikerExcel);
    
    document.getElementById('importKundenExcel').addEventListener('click', () => {
        document.getElementById('kundenExcelInput').click();
    });
    document.getElementById('kundenExcelInput').addEventListener('change', importKundenExcel);
    
    document.getElementById('closeProgress').addEventListener('click', closeProgressModal);
    
    // AI Assistant
    document.getElementById('saveOpenAIKey').addEventListener('click', saveOpenAIKey);
    document.getElementById('aiSendBtn').addEventListener('click', sendAIMessage);
    document.getElementById('aiInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendAIMessage();
        }
    });
    
    // Schedule / Dienstplan
    document.getElementById('openFullscreenCalendar').addEventListener('click', openFullscreenCalendar);
    document.getElementById('prevMonth').addEventListener('click', () => changeMonth(-1));
    document.getElementById('nextMonth').addEventListener('click', () => changeMonth(1));
    document.getElementById('viewMonth').addEventListener('click', () => setCalendarView('month'));
    document.getElementById('viewWeek').addEventListener('click', () => setCalendarView('week'));
    document.getElementById('viewToday').addEventListener('click', goToToday);
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.team-dropdown-container')) {
            document.getElementById('teamDropdownMenu')?.classList.remove('active');
            document.getElementById('teamDropdownMenuFullscreen')?.classList.remove('active');
        }
    });
    
    // Modal schließen
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', closeAllModals);
    });
    
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeAllModals();
        }
    });
    
    // Sidebar Resize
    initSidebarResize();
    
    // Draggable Analysis Panel
    initDraggablePanel();
    initCogSimWindow();
    loadAnonSetting();
    
    // Adresse zu Koordinaten bei Eingabe
    document.getElementById('techAddress').addEventListener('blur', () => {
        geocodeAddress('techAddress', 'techLat', 'techLng');
    });
    
    document.getElementById('kundeAddress').addEventListener('blur', () => {
        geocodeAddress('kundeAddress', 'kundeLat', 'kundeLng');
    });
}

// API Key speichern
function saveApiKey() {
    const key = document.getElementById('apiKey').value.trim();
    if (key) {
        apiKey = key;
        localStorage.setItem('ors_api_key', key);
        showStatus('apiStatus', 'API Key erfolgreich gespeichert!', 'success');
        
        // API Test anbieten
        setTimeout(() => {
            if (confirm('Möchten Sie die API-Verbindung jetzt testen?')) {
                testApiConnection();
            }
        }, 500);
    } else {
        showStatus('apiStatus', 'Bitte geben Sie einen API Key ein.', 'error');
    }
}

// API-Verbindung testen
async function testApiConnection() {
    if (!apiKey) {
        alert('❌ Bitte zuerst einen API Key eingeben!');
        return;
    }
    
    console.log('🔍 Teste API-Verbindung...');
    console.log(`API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
    
    const testLat = 51.1657;
    const testLng = 10.4515;
    
    try {
        const result = await fetchIsochrone(testLat, testLng, 'Test-Techniker');
        
        if (result.success) {
            alert('✅ API-Verbindung erfolgreich!\n\nDie OpenRouteService API ist erreichbar und Ihr API Key funktioniert.');
            console.log('✅ API Test erfolgreich:', result);
        } else {
            alert(`❌ API-Test fehlgeschlagen!\n\nFehler: ${result.error}\n\nBitte überprüfen Sie:\n1. API Key korrekt?\n2. Internet-Verbindung aktiv?\n3. Firewall-Einstellungen\n\nDetails in der Browser-Konsole (F12)`);
            console.error('❌ API Test fehlgeschlagen:', result);
        }
    } catch (error) {
        alert(`❌ Verbindungsfehler!\n\n${error.message}\n\nMögliche Ursachen:\n• Keine Internet-Verbindung\n• Firewall blockiert API\n• Ad-Blocker aktiv\n\nDetails in der Browser-Konsole (F12)`);
        console.error('❌ Verbindungsfehler:', error);
    }
}

// Status-Nachricht anzeigen
function showStatus(elementId, message, type) {
    const statusEl = document.getElementById(elementId);
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }
}

// Modal öffnen
function openModal(type) {
    if (type === 'techniker') {
        document.getElementById('technikerModal').style.display = 'block';
    } else if (type === 'kunde') {
        document.getElementById('kundeModal').style.display = 'block';
    }
}

// Alle Modals schließen
function closeAllModals() {
    document.getElementById('technikerModal').style.display = 'none';
    document.getElementById('kundeModal').style.display = 'none';
    document.getElementById('editSkillsModal').style.display = 'none';
    
    // Formulare zurücksetzen
    document.getElementById('technikerForm').reset();
    document.getElementById('kundeForm').reset();
    document.getElementById('editSkillsForm').reset();
    currentEditTechId = null;
}

// Sidebar Resize initialisieren
function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const resizeHandle = document.getElementById('sidebarResizeHandle');
    
    if (!sidebar || !resizeHandle) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    const MIN_WIDTH = 250;
    const MAX_WIDTH = window.innerWidth * 0.6; // 60% of screen width
    
    // Gespeicherte Breite laden
    const savedWidth = localStorage.getItem('sidebar_width');
    if (savedWidth) {
        const width = parseInt(savedWidth);
        const maxAllowed = window.innerWidth * 0.6;
        if (width >= MIN_WIDTH && width <= maxAllowed) {
            sidebar.style.width = width + 'px';
        }
    }
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        
        // Cursor für gesamte Page ändern während Resize
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        let newWidth = startWidth + deltaX;
        
        const MAX_WIDTH_DYNAMIC = window.innerWidth * 0.6; // 60% of screen
        
        // Breite limitieren
        if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
        if (newWidth > MAX_WIDTH_DYNAMIC) newWidth = MAX_WIDTH_DYNAMIC;
        
        sidebar.style.width = newWidth + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Breite speichern
            const currentWidth = sidebar.offsetWidth;
            localStorage.setItem('sidebar_width', currentWidth);
            
            console.log(`📏 Sidebar-Breite gespeichert: ${currentWidth}px`);
        }
    });
}

// Adresse zu Koordinaten umwandeln (Geocoding)
async function geocodeAddress(addressFieldId, latFieldId, lngFieldId) {
    const address = document.getElementById(addressFieldId).value.trim();
    
    if (!address) return;
    
    // Prüfen ob bereits Koordinaten eingegeben wurden (Format: lat,lng)
    if (address.includes(',')) {
        const parts = address.split(',');
        if (parts.length === 2) {
            const lat = parseFloat(parts[0].trim());
            const lng = parseFloat(parts[1].trim());
            if (!isNaN(lat) && !isNaN(lng)) {
                document.getElementById(latFieldId).value = lat;
                document.getElementById(lngFieldId).value = lng;
                return;
            }
        }
    }
    
    // Nominatim Geocoding (OpenStreetMap)
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=de`
        );
        const data = await response.json();
        
        if (data && data.length > 0) {
            document.getElementById(latFieldId).value = parseFloat(data[0].lat).toFixed(6);
            document.getElementById(lngFieldId).value = parseFloat(data[0].lon).toFixed(6);
        } else {
            alert('Adresse konnte nicht gefunden werden. Bitte Koordinaten manuell eingeben.');
        }
    } catch (error) {
        console.error('Geocoding Fehler:', error);
        alert('Fehler beim Geocoding. Bitte Koordinaten manuell eingeben.');
    }
}

// Collapsible Section aufklappen/zuklappen
function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    
    // Toggle Icon ID ermitteln
    let toggleIconId;
    if (sectionId === 'legendContent') {
        toggleIconId = 'legendContentToggle';
    } else if (sectionId === 'uncoveredList') {
        toggleIconId = 'uncoveredListToggle';
    } else {
        toggleIconId = sectionId.replace('Section', 'Toggle');
    }
    
    const toggleIcon = document.getElementById(toggleIconId);
    
    if (section.classList.contains('collapsed')) {
        section.classList.remove('collapsed');
        if (toggleIcon) toggleIcon.classList.remove('collapsed');
    } else {
        section.classList.add('collapsed');
        if (toggleIcon) toggleIcon.classList.add('collapsed');
    }
}

// Modal zum Bearbeiten der Skills öffnen
function openEditSkillsModal(techId) {
    const tech = techniker.find(t => t.id === techId);
    if (!tech) return;
    
    currentEditTechId = techId;
    document.getElementById('editTechName').value = tech.name;
    document.getElementById('editTechSkills').value = tech.skills ? tech.skills.join(', ') : '';
    document.getElementById('editSkillsModal').style.display = 'block';
}

// Bearbeitete Skills speichern
function saveEditedSkills(e) {
    e.preventDefault();
    
    if (currentEditTechId === null) return;
    
    const tech = techniker.find(t => t.id === currentEditTechId);
    if (!tech) return;
    
    const skillsInput = document.getElementById('editTechSkills').value.trim();
    const skills = skillsInput 
        ? skillsInput.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];
    
    tech.skills = skills;
    
    saveToLocalStorage();
    updateUI();
    updateFilters();
    updateAllMarkers();
    closeAllModals();
}

// Techniker hinzufügen
function addTechniker(e) {
    e.preventDefault();

    if (appMode === 'future') {
        addSimTechniker();
        return;
    }

    const name = document.getElementById('techName').value.trim();
    const lat = parseFloat(document.getElementById('techLat').value);
    const lng = parseFloat(document.getElementById('techLng').value);
    const skillsInput = document.getElementById('techSkills').value.trim();
    const rsl = document.getElementById('techRSL').value.trim();
    
    if (!name || isNaN(lat) || isNaN(lng)) {
        alert('Bitte alle Felder korrekt ausfüllen!');
        return;
    }
    
    // Skills verarbeiten (kommagetrennt)
    const skills = skillsInput 
        ? skillsInput.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];
    
    const newTechniker = {
        id: Date.now(),
        name: name,
        lat: lat,
        lng: lng,
        active: true,
        skills: skills,
        rsl: rsl,
        visible: true
    };
    
    techniker.push(newTechniker);
    saveToLocalStorage();
    updateUI();
    updateFilters();
    addTechnikerMarker(newTechniker);
    closeAllModals();
    
    // Karte zum Techniker zentrieren
    map.setView([lat, lng], 10);
}

// Kunde hinzufügen
function addKunde(e) {
    e.preventDefault();

    if (appMode === 'future') {
        addSimKunde();
        return;
    }

    const name = document.getElementById('kundeName').value.trim();
    const instrumentLine = document.getElementById('kundeInstrumentLine').value.trim();
    const fieldServiceManager = document.getElementById('kundeFieldServiceManager').value.trim();
    const lat = parseFloat(document.getElementById('kundeLat').value);
    const lng = parseFloat(document.getElementById('kundeLng').value);
    
    if (!name || isNaN(lat) || isNaN(lng)) {
        alert('Bitte alle Felder korrekt ausfüllen!');
        return;
    }
    
    const newKunde = {
        id: Date.now(),
        name: name,
        instrumentLines: instrumentLine ? [instrumentLine] : [],
        fieldServiceManager: fieldServiceManager,
        lat: lat,
        lng: lng,
        covered: false,
        visible: true,
        deviceAssignments: {} // Assignment system: { "deviceType": techId }
    };
    
    kunden.push(newKunde);
    saveToLocalStorage();
    updateUI();
    updateFilters();
    addKundeMarker(newKunde);
    closeAllModals();
    
    // Karte zum Kunden zentrieren
    map.setView([lat, lng], 10);
}

// Techniker Marker zur Karte hinzufügen
function addTechnikerMarker(tech) {
    // Icon basierend auf Status bestimmen
    const iconData = getTechnikerIcon(tech);
    
    const icon = L.divIcon({
        html: iconData.html,
        className: 'custom-marker',
        iconSize: [40, 30],
        iconAnchor: [20, 15]
    });
    
    const skillsText = tech.skills && tech.skills.length > 0 
        ? `<div class="popup-info">🎯 Skills: ${tech.skills.join(', ')}</div>`
        : `<div class="popup-info">🎯 Keine Skills</div>`;
    
    const marker = L.marker([tech.lat, tech.lng], { icon: icon })
        .bindPopup(`
            <div class="popup-title">${tech.name}</div>
            <div class="popup-info">📍 ${tech.lat.toFixed(4)}, ${tech.lng.toFixed(4)}</div>
            <div class="popup-info">Status: ${iconData.statusText}</div>
            ${skillsText}
        `);
    
    // Nur zur Karte hinzufügen wenn visible
    if (tech.visible !== false) {
        marker.addTo(map);
    }
    
    technikerMarkers.push({ id: tech.id, marker: marker, tech: tech });
}

// Icon für Techniker basierend auf Status bestimmen
function getTechnikerIcon(tech) {
    // Im Strategiemodus: Grau-farbenes T für alle Techniker
    if (appMode === 'strategy') {
        return { 
            html: '<div style="background: linear-gradient(90deg, #576574, #8395a7); color: white; padding: 4px 10px; border-radius: 50%; font-weight: bold; font-size: 14px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">T</div>',
            statusText: 'Verfügbar (Strategiemodus)',
            availableForAnalysis: true
        };
    }
    
    // Hole aktuelles Datum (oder selectedDate wenn gesetzt)
    const currentDate = selectedDate ? selectedDate : new Date();
    const dateStr = formatDate(currentDate);
    
    // Hole Status aus Schedule
    const status = getScheduleStatus(tech.id, dateStr);
    
    // Wenn ein Status-Code existiert, diesen anzeigen (hat Priorität!)
    switch(status) {
        case 'ZR': // Bereitschaft - Orange
            return { 
                html: '<div style="background: #fd7e14; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">ZR</div>',
                statusText: 'Bereitschaft',
                availableForAnalysis: true
            };
        case 'X': // Abwesend - Rot
            return { 
                html: '<div style="background: #dc3545; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">X</div>',
                statusText: 'Abwesend',
                availableForAnalysis: false
            };
        case 'I': // Installation - Lila
            return { 
                html: '<div style="background: #6f42c1; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">I</div>',
                statusText: 'Installation',
                availableForAnalysis: false
            };
        case 'W': // Wartung - Gelb
            return { 
                html: '<div style="background: #ffc107; color: black; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">W</div>',
                statusText: 'Wartung',
                availableForAnalysis: false
            };
        case 'K': // Krank - Türkis
            return { 
                html: '<div style="background: #20c997; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">K</div>',
                statusText: 'Krank',
                availableForAnalysis: false
            };
        case 'U': // Urlaub - Türkis (gleiche Farbe wie K)
            return { 
                html: '<div style="background: #20c997; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">U</div>',
                statusText: 'Urlaub',
                availableForAnalysis: false
            };
    }
    
    // Kein Status-Code gefunden
    // Jetzt prüfen ob manuell deaktiviert
    if (!tech.active) {
        return { 
            html: '<div style="background: #6c757d; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">OFF</div>',
            statusText: 'Inaktiv (manuell)',
            availableForAnalysis: false
        };
    }
    
    // Kein Status und aktiv = Fragezeichen
    return { 
        html: '<div style="background: #6c757d; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 14px;">?</div>',
        statusText: 'Kein Status',
        availableForAnalysis: false
    };
}

// Kunden Marker zur Karte hinzufügen
function addKundeMarker(kunde) {
    const icon = L.divIcon({
        html: `<div style="font-size: 25px;">${kunde.covered ? '🏢' : '⚠️'}</div>`,
        className: 'custom-marker',
        iconSize: [25, 25],
        iconAnchor: [12, 12]
    });
    
    // Ensure instrumentLines is an array (backward compatibility)
    if (!Array.isArray(kunde.instrumentLines)) {
        kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
    }
    
    // Alle Geräte mit Coverage-Status anzeigen
    let instrumentLinesText = '';
    if (kunde.instrumentLines && kunde.instrumentLines.length > 0) {
        const coveredList = kunde.coveredDevicesList || [];
        instrumentLinesText = kunde.instrumentLines.map(line => {
            const isCovered = coveredList.includes(line);
            const icon = isCovered ? '✅' : '❌';
            const color = isCovered ? '#28a745' : '#dc3545';
            return `<div class="popup-info" style="color: ${color}; font-weight: 500;">${icon} ${line}</div>`;
        }).join('');
    } else {
        instrumentLinesText = '<div class="popup-info">🏭 Keine Geräte</div>';
    }
    
    // Coverage-Zusammenfassung
    const coveredCount = kunde.coveredDevices || 0;
    const totalCount = kunde.totalDevices || 0;
    const coverageSummary = totalCount > 0 
        ? `${coveredCount}/${totalCount} Geräte abgedeckt`
        : 'Keine Geräte';
    
    const marker = L.marker([kunde.lat, kunde.lng], { icon: icon })
        .bindPopup(`
            <div class="popup-title">${kunde.name}</div>
            <div class="popup-info">📍 ${kunde.lat.toFixed(4)}, ${kunde.lng.toFixed(4)}</div>
            <div class="popup-info" style="font-weight: 600; color: ${kunde.covered ? '#28a745' : '#dc3545'};">
                ${kunde.covered ? '✅ Vollständig abgedeckt' : '⚠️ ' + coverageSummary}
            </div>
            <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #e0e0e0;">
                <strong style="font-size: 12px;">Geräte:</strong>
                ${instrumentLinesText}
            </div>
        `);
    
    // Nur zur Karte hinzufügen wenn visible
    if (kunde.visible !== false) {
        marker.addTo(map);
    }
    
    kundenMarkers.push({ id: kunde.id, marker: marker, kunde: kunde });
}

// Alle Marker aktualisieren
function updateAllMarkers() {
    // Techniker Marker entfernen
    technikerMarkers.forEach(item => {
        map.removeLayer(item.marker);
    });
    technikerMarkers = [];
    
    // Kunden Marker entfernen
    kundenMarkers.forEach(item => {
        map.removeLayer(item.marker);
    });
    kundenMarkers = [];
    
    // Neu hinzufügen
    techniker.forEach(tech => addTechnikerMarker(tech));
    kunden.forEach(kunde => addKundeMarker(kunde));
}

// UI aktualisieren (Listen und Statistiken)
function updateUI() {
    updateTechnikerList();
    updateKundenList();
    updateStatistics();
}

// Techniker Liste aktualisieren
function updateTechnikerList() {
    const list = document.getElementById('technikerList');
    list.innerHTML = '';
    
    techniker.forEach(tech => {
        const skillsText = tech.skills && tech.skills.length > 0 
            ? `<div style="font-size: 11px; color: #667eea;">🎯 ${tech.skills.join(', ')}</div>`
            : '';
        
        const visibilityClass = tech.visible === false ? 'opacity: 0.3;' : '';
        
        const item = document.createElement('div');
        item.className = `list-item ${!tech.active ? 'inactive' : ''}`;
        item.style = visibilityClass;
        item.innerHTML = `
            <div class="list-item-info">
                <div class="list-item-name">${tech.name}</div>
                ${skillsText}
                <div class="list-item-coords">${tech.lat.toFixed(4)}, ${tech.lng.toFixed(4)}</div>
            </div>
            <div class="list-item-actions">
                <button class="btn-toggle ${!tech.active ? 'inactive' : ''}" onclick="toggleTechniker(${tech.id})">
                    ${tech.active ? 'An' : 'Aus'}
                </button>
                <button class="btn-edit" onclick="openEditSkillsModal(${tech.id})" title="Skills bearbeiten">✏️</button>
                <button class="btn-zoom" onclick="zoomToLocation(${tech.lat}, ${tech.lng})">🎯</button>
                <button class="btn-delete" onclick="deleteTechniker(${tech.id})">🗑️</button>
            </div>
        `;
        list.appendChild(item);
    });
}

// Kunden Liste aktualisieren
function updateKundenList() {
    const list = document.getElementById('kundenList');
    list.innerHTML = '';
    
    kunden.forEach(kunde => {
        // Ensure instrumentLines is an array (backward compatibility)
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        // Count and display devices with quantity (e.g., "2x Pro")
        let instrumentLinesText = '<div style="font-size: 11px; color: #6c757d; margin-top: 2px;">🏭 Keine Geräte</div>';
        
        if (kunde.instrumentLines && kunde.instrumentLines.length > 0) {
            // Count occurrences of each device
            const deviceCounts = {};
            kunde.instrumentLines.forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    deviceCounts[trimmedLine] = (deviceCounts[trimmedLine] || 0) + 1;
                }
            });
            
            // Create HTML with counts
            instrumentLinesText = Object.entries(deviceCounts)
                .map(([device, count]) => {
                    const displayText = count > 1 ? `${count}x ${device}` : device;
                    return `<div style="font-size: 11px; color: #f39c12; margin-top: 2px;">🏭 ${displayText}</div>`;
                })
                .join('');
        }
        
        const visibilityClass = kunde.visible === false ? 'opacity: 0.3;' : '';
        
        const item = document.createElement('div');
        item.className = 'list-item';
        item.style = visibilityClass;
        item.innerHTML = `
            <div class="list-item-info">
                <div class="list-item-name">${kunde.name} ${kunde.covered ? '✓' : '⚠️'}</div>
                ${instrumentLinesText}
                <div class="list-item-coords">${kunde.lat.toFixed(4)}, ${kunde.lng.toFixed(4)}</div>
            </div>
            <div class="list-item-actions">
                <button class="btn-zoom" onclick="zoomToLocation(${kunde.lat}, ${kunde.lng})">🎯</button>
                <button class="btn-delete" onclick="deleteKunde(${kunde.id})">🗑️</button>
            </div>
        `;
        list.appendChild(item);
    });
}

// Statistiken aktualisieren
function updateStatistics() {
    const activeTechs = techniker.filter(t => t.active).length;
    const coveredCustomers = kunden.filter(k => k.covered).length;
    const uncoveredCustomers = kunden.length - coveredCustomers;
    
    document.getElementById('activeTechCount').textContent = activeTechs;
    document.getElementById('coveredCustomers').textContent = coveredCustomers;
    document.getElementById('uncoveredCustomers').textContent = uncoveredCustomers;
    
    // Liste der nicht abgedeckten Kunden aktualisieren
    updateUncoveredCustomersList();
}

// Liste der nicht abgedeckten Kunden aktualisieren
function updateUncoveredCustomersList() {
    const uncoveredCustomers = kunden.filter(k => !k.covered && k.visible !== false);
    const uncoveredSection = document.getElementById('uncoveredSection');
    const uncoveredList = document.getElementById('uncoveredCustomersList');
    
    // Section nur anzeigen wenn es nicht abgedeckte Kunden gibt
    if (uncoveredCustomers.length === 0) {
        uncoveredSection.style.display = 'none';
        return;
    }
    
    uncoveredSection.style.display = 'block';
    uncoveredList.innerHTML = '';
    
    // Sortiere alphabetisch nach Name
    uncoveredCustomers.sort((a, b) => a.name.localeCompare(b.name));
    
    uncoveredCustomers.forEach(kunde => {
        // Ensure instrumentLines is an array (backward compatibility)
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        // Count and display devices with quantity (e.g., "2x Pro")
        let instrumentLinesText = '';
        
        if (kunde.instrumentLines && kunde.instrumentLines.length > 0) {
            // Count occurrences of each device
            const deviceCounts = {};
            kunde.instrumentLines.forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine) {
                    deviceCounts[trimmedLine] = (deviceCounts[trimmedLine] || 0) + 1;
                }
            });
            
            // Create HTML with counts
            instrumentLinesText = Object.entries(deviceCounts)
                .map(([device, count]) => {
                    const displayText = count > 1 ? `${count}x ${device}` : device;
                    return `<div style="font-size: 11px; color: #dc3545; margin-top: 2px;">🏭 ${displayText}</div>`;
                })
                .join('');
        }
        
        const item = document.createElement('div');
        item.className = 'uncovered-customer-item';
        item.innerHTML = `
            <div style="flex: 1;">
                <div style="font-weight: 500; font-size: 13px; color: #856404;">${kunde.name}</div>
                ${instrumentLinesText}
                <div style="font-size: 11px; color: #6c757d; margin-top: 3px;">📍 ${kunde.lat.toFixed(4)}, ${kunde.lng.toFixed(4)}</div>
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="btn-zoom" onclick="zoomToLocation(${kunde.lat}, ${kunde.lng})" style="padding: 4px 8px; font-size: 11px;">🎯</button>
            </div>
        `;
        uncoveredList.appendChild(item);
    });
}

// Prüfen ob Isochronen für einen Techniker angezeigt werden sollen
function shouldShowIsochrone(tech) {
    // Manuell deaktiviert?
    if (!tech.active) {
        return false;
    }
    
    // Im Strategiemodus: Alle aktiven Techniker zeigen
    if (appMode === 'strategy') {
        return true;
    }
    
    // Status für heute (oder selectedDate) prüfen
    const checkDate = selectedDate ? selectedDate : new Date();
    const dateStr = formatDate(checkDate);
    const status = getScheduleStatus(tech.id, dateStr);
    
    // Nur bei Status ZR (Bereitschaft) Isochronen anzeigen
    return status === 'ZR';
}

// Techniker ein/ausschalten
function toggleTechniker(id) {
    const tech = techniker.find(t => t.id === id);
    if (tech) {
        tech.active = !tech.active;
        
        // Isochrone für diesen Techniker ein-/ausblenden
        const isoLayer = isochroneLayers.find(layer => layer.techId === id);
        if (isoLayer) {
            // Prüfen ob Isochrone angezeigt werden soll
            // Berücksichtigt: Status, Filter (visible) und manuelles active
            const shouldShow = tech.visible !== false && shouldShowIsochrone(tech);
            
            if (shouldShow && !map.hasLayer(isoLayer.layer)) {
                // Isochrone einblenden
                map.addLayer(isoLayer.layer);
            } else if (!shouldShow && map.hasLayer(isoLayer.layer)) {
                // Isochrone ausblenden
                map.removeLayer(isoLayer.layer);
            }
            
            // Kundenabdeckung neu berechnen (offline!)
            if (isochroneGeoJSON.length > 0) {
                console.log('🔄 Berechne Kundenabdeckung neu nach Techniker-Änderung...');
                checkCustomerCoverage();
                updateAllMarkers(); // Marker-Farben aktualisieren
                updateStatistics(); // Statistiken aktualisieren
            }
        }
        
        saveToLocalStorage();
        updateUI();
    }
}

// Techniker löschen
function deleteTechniker(id) {
    if (confirm('Techniker wirklich löschen?')) {
        techniker = techniker.filter(t => t.id !== id);
        
        // Dienstplan-Einträge des Technikers löschen
        if (schedule[id]) {
            delete schedule[id];
        }
        
        saveToLocalStorage();
        updateUI();
        updateAllMarkers();
        renderScheduleCalendar(); // Kalender aktualisieren
    }
}

// Kunde löschen
function deleteKunde(id) {
    if (confirm('Kunde wirklich löschen?')) {
        kunden = kunden.filter(k => k.id !== id);
        saveToLocalStorage();
        updateUI();
        updateAllMarkers();
    }
}

// Alle Daten löschen (Techniker und Kunden)
function deleteAllData() {
    const confirmation = confirm(
        '⚠️ WARNUNG ⚠️\n\n' +
        'Möchten Sie wirklich ALLE Daten löschen?\n\n' +
        '• Alle Techniker werden gelöscht\n' +
        '• Alle Kunden werden gelöscht\n' +
        '• Alle Isochronen werden entfernt\n' +
        '• Alle Filter werden zurückgesetzt\n\n' +
        'Diese Aktion kann NICHT rückgängig gemacht werden!\n\n' +
        'Sind Sie sicher?'
    );
    
    if (confirmation) {
        // Nochmalige Bestätigung für Sicherheit
        const doubleConfirm = confirm(
            '🚨 LETZTE BESTÄTIGUNG 🚨\n\n' +
            'Sie sind dabei, ALLE Daten unwiderruflich zu löschen!\n\n' +
            'Wirklich fortfahren?'
        );
        
        if (doubleConfirm) {
            console.log('🗑️ Lösche alle Daten...');
            
            // Alle Arrays leeren
            techniker = [];
            kunden = [];
            schedule = {};
            isochroneGeoJSON = [];
            
            // Alle Marker entfernen
            technikerMarkers.forEach(item => map.removeLayer(item.marker));
            kundenMarkers.forEach(item => map.removeLayer(item.marker));
            technikerMarkers = [];
            kundenMarkers = [];
            
            // Alle Isochronen entfernen
            clearIsochrones();
            
            // Filter zurücksetzen
            activeSkillFilters.clear();
            activeInstrumentLineFilters.clear();
            activeRSLFilters.clear();
            
            // LocalStorage leeren (Legacy)
            localStorage.removeItem('techniker_app_data');
            
            // IndexedDB leeren
            saveToLocalStorage();
            
            // UI aktualisieren
            updateUI();
            updateFilters();
            renderScheduleCalendar();
            
            console.log('✅ Alle Daten wurden gelöscht');
            alert('✅ Alle Daten wurden erfolgreich gelöscht!');
        }
    }
}

// Zu bestimmtem Standort zoomen
function zoomToLocation(lat, lng) {
    map.setView([lat, lng], 13);
}

// ===== FILTER FUNKTIONEN =====

// Alle verfügbaren Skills und InstrumentLines sammeln und Filter-UI aktualisieren
function updateFilters() {
    // Initiale Aktivierung aller Filter beim ersten Laden
    initializeFiltersIfEmpty();
    
    updateSkillFilters();
    updateInstrumentLineFilters();
    updateRSLFilters();
}

// Filter initial aktivieren (nur wenn noch leer)
function initializeFiltersIfEmpty() {
    // Skills
    if (activeSkillFilters.size === 0) {
        techniker.forEach(tech => {
            if (tech.skills && Array.isArray(tech.skills)) {
                tech.skills.forEach(skill => {
                    if (skill && skill.trim()) {
                        activeSkillFilters.add(skill.trim());
                    }
                });
            }
        });
    }
    
    // InstrumentLines
    if (activeInstrumentLineFilters.size === 0) {
        kunden.forEach(kunde => {
            if (!Array.isArray(kunde.instrumentLines)) {
                kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
            }
            kunde.instrumentLines.forEach(line => {
                if (line && line.trim()) {
                    activeInstrumentLineFilters.add(line.trim());
                }
            });
        });
    }
    
    // RSLs
    if (activeRSLFilters.size === 0) {
        techniker.forEach(tech => {
            if (tech.rsl && tech.rsl.trim()) {
                activeRSLFilters.add(tech.rsl.trim());
            }
        });
    }
}

// Skill-Filter aktualisieren
function updateSkillFilters() {
    const allSkills = new Set();
    
    // Alle Skills von allen Technikern sammeln
    techniker.forEach(tech => {
        if (tech.skills && Array.isArray(tech.skills)) {
            tech.skills.forEach(skill => {
                if (skill && skill.trim()) {
                    allSkills.add(skill.trim());
                }
            });
        }
    });
    
    const filterContainer = document.getElementById('skillFilter');
    
    if (allSkills.size === 0) {
        filterContainer.innerHTML = '<small style="color: #6c757d;">Keine Skills vorhanden</small>';
        return;
    }
    
    // Skill-Checkboxen erstellen
    filterContainer.innerHTML = '';
    
    // Toggle-Button Header
    const toggleState = getFilterToggleState(activeSkillFilters, allSkills);
    const headerDiv = document.createElement('div');
    headerDiv.className = 'filter-header';
    headerDiv.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 8px;';
    headerDiv.innerHTML = `
        <button class="filter-toggle-btn ${toggleState.class}" onclick="toggleAllSkillFilters()" id="skillToggleBtn">
            ${toggleState.text}
        </button>
    `;
    filterContainer.appendChild(headerDiv);
    
    const sortedSkills = Array.from(allSkills).sort();
    
    sortedSkills.forEach(skill => {
        const count = techniker.filter(t => 
            t.skills && t.skills.includes(skill)
        ).length;
        
        const isChecked = activeSkillFilters.has(skill);
        
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        filterItem.innerHTML = `
            <input type="checkbox" id="skill_${skill}" ${isChecked ? 'checked' : ''}>
            <label for="skill_${skill}">${skill}</label>
            <span class="filter-count">${count}</span>
        `;
        
        const checkbox = filterItem.querySelector('input');
        checkbox.addEventListener('change', () => toggleSkillFilter(skill));
        
        filterContainer.appendChild(filterItem);
    });
}

// InstrumentLine-Filter aktualisieren
function updateInstrumentLineFilters() {
    const allInstrumentLines = new Set();
    
    // Alle InstrumentLines von allen Kunden sammeln
    kunden.forEach(kunde => {
        // Ensure instrumentLines is an array (backward compatibility)
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        if (kunde.instrumentLines && kunde.instrumentLines.length > 0) {
            kunde.instrumentLines.forEach(line => {
                if (line && line.trim()) {
                    allInstrumentLines.add(line.trim());
                }
            });
        }
    });
    
    const filterContainer = document.getElementById('instrumentLineFilter');
    
    if (allInstrumentLines.size === 0) {
        filterContainer.innerHTML = '<small style="color: #6c757d;">Keine InstrumentLines vorhanden</small>';
        return;
    }
    
    // InstrumentLine-Checkboxen erstellen
    filterContainer.innerHTML = '';
    
    // Toggle-Button Header
    const toggleState = getFilterToggleState(activeInstrumentLineFilters, allInstrumentLines);
    const headerDiv = document.createElement('div');
    headerDiv.className = 'filter-header';
    headerDiv.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 8px;';
    headerDiv.innerHTML = `
        <button class="filter-toggle-btn ${toggleState.class}" onclick="toggleAllInstrumentLineFilters()" id="instrumentLineToggleBtn">
            ${toggleState.text}
        </button>
    `;
    filterContainer.appendChild(headerDiv);
    
    const sortedLines = Array.from(allInstrumentLines).sort();
    
    sortedLines.forEach(line => {
        // Zähle Kunden die diese InstrumentLine haben
        const count = kunden.filter(k => {
            if (!Array.isArray(k.instrumentLines)) {
                k.instrumentLines = k.instrumentLineName ? [k.instrumentLineName] : [];
            }
            return k.instrumentLines.includes(line);
        }).length;
        
        const isChecked = activeInstrumentLineFilters.has(line);
        
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        filterItem.innerHTML = `
            <input type="checkbox" id="line_${line}" ${isChecked ? 'checked' : ''}>
            <label for="line_${line}">${line}</label>
            <span class="filter-count">${count}</span>
        `;
        
        const checkbox = filterItem.querySelector('input');
        checkbox.addEventListener('change', () => toggleInstrumentLineFilter(line));
        
        filterContainer.appendChild(filterItem);
    });
}

// RSL-Filter aktualisieren
function updateRSLFilters() {
    const allRSLs = new Set();
    
    // Alle RSLs von allen Technikern sammeln
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            allRSLs.add(tech.rsl.trim());
        }
    });
    
    const filterContainer = document.getElementById('rslFilter');
    
    if (allRSLs.size === 0) {
        filterContainer.innerHTML = '<small style="color: #6c757d;">Keine Teamgebiete vorhanden</small>';
        
        // Dropdowns leeren
        updateTeamDropdowns([]);
        return;
    }
    
    // Dropdowns aktualisieren
    updateTeamDropdowns(Array.from(allRSLs).sort());
    
    // RSL-Checkboxen erstellen
    filterContainer.innerHTML = '';
    
    // Toggle-Button Header
    const toggleState = getFilterToggleState(activeRSLFilters, allRSLs);
    const headerDiv = document.createElement('div');
    headerDiv.className = 'filter-header';
    headerDiv.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 8px;';
    headerDiv.innerHTML = `
        <button class="filter-toggle-btn ${toggleState.class}" onclick="toggleAllRSLFilters()" id="rslToggleBtn">
            ${toggleState.text}
        </button>
    `;
    filterContainer.appendChild(headerDiv);
    
    const sortedRSLs = Array.from(allRSLs).sort();
    
    sortedRSLs.forEach(rsl => {
        const count = techniker.filter(t => t.rsl === rsl).length;
        
        const isChecked = activeRSLFilters.has(rsl);
        
        const filterItem = document.createElement('div');
        filterItem.className = 'filter-item';
        filterItem.innerHTML = `
            <input type="checkbox" id="rsl_${rsl}" ${isChecked ? 'checked' : ''}>
            <label for="rsl_${rsl}">${rsl}</label>
            <span class="filter-count">${count}</span>
        `;
        
        const checkbox = filterItem.querySelector('input');
        checkbox.addEventListener('change', () => toggleRSLFilter(rsl));
        
        filterContainer.appendChild(filterItem);
    });
}

// Team Dropdowns aktualisieren
function updateTeamDropdowns(teams) {
    const menu1 = document.getElementById('teamDropdownMenu');
    const menu2 = document.getElementById('teamDropdownMenuFullscreen');
    
    [menu1, menu2].forEach(menu => {
        if (!menu) return;
        
        menu.innerHTML = '';
        
        if (teams.length === 0) {
            menu.innerHTML = '<div style="padding: 8px; color: #6c757d; font-size: 11px;">Keine Teamgebiete vorhanden</div>';
        } else {
            teams.forEach(team => {
                const item = document.createElement('div');
                item.className = 'team-dropdown-item';
                
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = menu === menu1 ? `team_${team}` : `team_fs_${team}`;
                checkbox.checked = activeRSLFilters.has(team);
                checkbox.addEventListener('change', () => handleTeamCheckboxChange(team));
                
                const label = document.createElement('label');
                label.htmlFor = checkbox.id;
                label.textContent = team;
                
                item.appendChild(checkbox);
                item.appendChild(label);
                menu.appendChild(item);
            });
        }
    });
    
    updateTeamDropdownLabels();
}

// Toggle Team Dropdown (sidebar)
function toggleTeamDropdown() {
    const menu = document.getElementById('teamDropdownMenu');
    const otherMenu = document.getElementById('teamDropdownMenuFullscreen');
    
    menu.classList.toggle('active');
    otherMenu.classList.remove('active');
}

// Toggle Team Dropdown (fullscreen)
function toggleTeamDropdownFullscreen() {
    const menu = document.getElementById('teamDropdownMenuFullscreen');
    const otherMenu = document.getElementById('teamDropdownMenu');
    
    menu.classList.toggle('active');
    otherMenu.classList.remove('active');
}

// Handle Team Checkbox Change
function handleTeamCheckboxChange(team) {
    if (activeRSLFilters.has(team)) {
        activeRSLFilters.delete(team);
    } else {
        activeRSLFilters.add(team);
    }
    
    // Wenn keine Teams mehr ausgewählt, alle aktivieren
    const allTeams = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            allTeams.add(tech.rsl.trim());
        }
    });
    
    if (activeRSLFilters.size === 0) {
        allTeams.forEach(t => activeRSLFilters.add(t));
    }
    
    // Checkboxen in beiden Dropdowns synchronisieren
    syncTeamCheckboxes();
    
    // Sidebar Checkboxen aktualisieren
    updateRSLCheckboxes();
    
    // Labels aktualisieren
    updateTeamDropdownLabels();
    
    // Filter anwenden (aktualisiert auch Analyse)
    applyFilters();
    renderScheduleCalendar();
}

// Sync Team Checkboxes between dropdowns
function syncTeamCheckboxes() {
    const allTeams = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            allTeams.add(tech.rsl.trim());
        }
    });
    
    allTeams.forEach(team => {
        const checkbox1 = document.getElementById(`team_${team}`);
        const checkbox2 = document.getElementById(`team_fs_${team}`);
        
        if (checkbox1) checkbox1.checked = activeRSLFilters.has(team);
        if (checkbox2) checkbox2.checked = activeRSLFilters.has(team);
    });
}

// Update dropdown button labels
function updateTeamDropdownLabels() {
    const allTeams = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            allTeams.add(tech.rsl.trim());
        }
    });
    
    const label1 = document.getElementById('teamDropdownLabel');
    const label2 = document.getElementById('teamDropdownLabelFullscreen');
    
    let labelText;
    if (activeRSLFilters.size === 0 || activeRSLFilters.size === allTeams.size) {
        labelText = '🏢 Teamgebiet: Alle';
    } else if (activeRSLFilters.size === 1) {
        labelText = `🏢 Teamgebiet: ${Array.from(activeRSLFilters)[0]}`;
    } else {
        labelText = `🏢 Teamgebiet: ${activeRSLFilters.size} ausgewählt`;
    }
    
    if (label1) label1.textContent = labelText;
    if (label2) label2.textContent = labelText;
}

// Team Dropdown Änderung behandeln (deprecated, kept for compatibility)
function handleTeamDropdownChange(e) {
    // This function is no longer used but kept for compatibility
}

// RSL Checkboxen nach Dropdown-Änderung aktualisieren
function updateRSLCheckboxes() {
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            const checkbox = document.getElementById(`rsl_${tech.rsl.trim()}`);
            if (checkbox) {
                checkbox.checked = activeRSLFilters.has(tech.rsl.trim());
            }
        }
    });
}

// Hilfsfunktion: Toggle-Button Status ermitteln
function getFilterToggleState(activeFilters, allFilters) {
    const allCount = allFilters.size;
    const activeCount = activeFilters.size;
    
    if (activeCount === allCount) {
        return { class: 'all-selected', text: '✓ Alle' };
    } else if (activeCount === 0) {
        return { class: 'none-selected', text: '✗ Keine' };
    } else {
        return { class: 'some-selected', text: `${activeCount}/${allCount}` };
    }
}

// Alle Skill-Filter umschalten
function toggleAllSkillFilters() {
    const allSkills = new Set();
    techniker.forEach(tech => {
        if (tech.skills && Array.isArray(tech.skills)) {
            tech.skills.forEach(skill => {
                if (skill && skill.trim()) allSkills.add(skill.trim());
            });
        }
    });
    
    // Wenn alle aktiv -> keine, wenn keine oder teilweise -> alle
    if (activeSkillFilters.size === allSkills.size) {
        activeSkillFilters.clear();
    } else if (activeSkillFilters.size === 0) {
        allSkills.forEach(skill => activeSkillFilters.add(skill));
    } else {
        // Teilweise ausgewählt -> alle aktivieren
        allSkills.forEach(skill => activeSkillFilters.add(skill));
    }
    
    updateSkillFilters();
    applyFilters();
}

// Alle InstrumentLine-Filter umschalten
function toggleAllInstrumentLineFilters() {
    const allLines = new Set();
    kunden.forEach(kunde => {
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        kunde.instrumentLines.forEach(line => {
            if (line && line.trim()) allLines.add(line.trim());
        });
    });
    
    // Wenn alle aktiv -> keine, wenn keine oder teilweise -> alle
    if (activeInstrumentLineFilters.size === allLines.size) {
        activeInstrumentLineFilters.clear();
    } else if (activeInstrumentLineFilters.size === 0) {
        allLines.forEach(line => activeInstrumentLineFilters.add(line));
    } else {
        // Teilweise ausgewählt -> alle aktivieren
        allLines.forEach(line => activeInstrumentLineFilters.add(line));
    }
    
    updateInstrumentLineFilters();
    applyFilters();
}

// Alle RSL-Filter umschalten
function toggleAllRSLFilters() {
    const allRSLs = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) allRSLs.add(tech.rsl.trim());
    });
    
    // Wenn alle aktiv -> keine, wenn keine oder teilweise -> alle
    if (activeRSLFilters.size === allRSLs.size) {
        activeRSLFilters.clear();
    } else if (activeRSLFilters.size === 0) {
        allRSLs.forEach(rsl => activeRSLFilters.add(rsl));
    } else {
        // Teilweise ausgewählt -> alle aktivieren
        allRSLs.forEach(rsl => activeRSLFilters.add(rsl));
    }
    
    updateRSLFilters();
    syncTeamCheckboxes();
    updateTeamDropdownLabels();
    applyFilters();
    renderScheduleCalendar();
}

// Skill-Filter umschalten
function toggleSkillFilter(skill) {
    if (activeSkillFilters.has(skill)) {
        activeSkillFilters.delete(skill);
    } else {
        activeSkillFilters.add(skill);
    }
    
    updateSkillFilterToggleButton();
    applyFilters();
}

// Skill-Toggle-Button aktualisieren
function updateSkillFilterToggleButton() {
    const allSkills = new Set();
    techniker.forEach(tech => {
        if (tech.skills && Array.isArray(tech.skills)) {
            tech.skills.forEach(skill => {
                if (skill && skill.trim()) allSkills.add(skill.trim());
            });
        }
    });
    
    const btn = document.getElementById('skillToggleBtn');
    if (btn) {
        const state = getFilterToggleState(activeSkillFilters, allSkills);
        btn.className = `filter-toggle-btn ${state.class}`;
        btn.textContent = state.text;
    }
}

// InstrumentLine-Filter umschalten
function toggleInstrumentLineFilter(line) {
    if (activeInstrumentLineFilters.has(line)) {
        activeInstrumentLineFilters.delete(line);
    } else {
        activeInstrumentLineFilters.add(line);
    }
    
    updateInstrumentLineFilterToggleButton();
    applyFilters();
}

// InstrumentLine-Toggle-Button aktualisieren
function updateInstrumentLineFilterToggleButton() {
    const allLines = new Set();
    kunden.forEach(kunde => {
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        kunde.instrumentLines.forEach(line => {
            if (line && line.trim()) allLines.add(line.trim());
        });
    });
    
    const btn = document.getElementById('instrumentLineToggleBtn');
    if (btn) {
        const state = getFilterToggleState(activeInstrumentLineFilters, allLines);
        btn.className = `filter-toggle-btn ${state.class}`;
        btn.textContent = state.text;
    }
}

// RSL-Filter umschalten
function toggleRSLFilter(rsl) {
    if (activeRSLFilters.has(rsl)) {
        activeRSLFilters.delete(rsl);
    } else {
        activeRSLFilters.add(rsl);
    }
    
    // Dropdown Checkboxen synchronisieren
    syncTeamCheckboxes();
    
    // Dropdown Labels aktualisieren
    updateTeamDropdownLabels();
    
    // Toggle-Button aktualisieren
    updateRSLFilterToggleButton();
    
    applyFilters();
    renderScheduleCalendar();
}

// RSL-Toggle-Button aktualisieren
function updateRSLFilterToggleButton() {
    const allRSLs = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) allRSLs.add(tech.rsl.trim());
    });
    
    const btn = document.getElementById('rslToggleBtn');
    if (btn) {
        const state = getFilterToggleState(activeRSLFilters, allRSLs);
        btn.className = `filter-toggle-btn ${state.class}`;
        btn.textContent = state.text;
    }
}

// Filter anwenden
function applyFilters() {
    // Alle verfügbaren Teamgebiete ermitteln
    const allTeams = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            allTeams.add(tech.rsl.trim());
        }
    });
    
    // Team-Filter ist nur aktiv wenn NICHT alle Teams ausgewählt sind
    // (wenn alle Teams ausgewählt sind = kein Filter = zeige alle)
    const isTeamFilterActive = activeRSLFilters.size > 0 && activeRSLFilters.size < allTeams.size;
    
    // Techniker filtern
    techniker.forEach(tech => {
        let visible = true;
        
        // RSL-Filter (falls RSL vorhanden oder Filter aktiv)
        if (isTeamFilterActive) {
            // Filter ist aktiv: Nur Techniker mit passendem RSL anzeigen
            if (tech.rsl && tech.rsl.trim()) {
                visible = visible && activeRSLFilters.has(tech.rsl.trim());
            } else {
                // Techniker ohne RSL ausblenden wenn Filter aktiv
                visible = false;
            }
        }
        
        // Skill-Filter (nur wenn Techniker Skills hat)
        if (visible && tech.skills && tech.skills.length > 0) {
            visible = visible && tech.skills.some(skill => activeSkillFilters.has(skill));
        }
        
        tech.visible = visible;
    });
    
    // Kunden filtern
    kunden.forEach(kunde => {
        // Ensure instrumentLines is an array (backward compatibility)
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        let visible = false;
        
        // InstrumentLine-Filter - IMMER prüfen
        if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) {
            visible = true; // Kunden ohne Geräte immer anzeigen
        } else {
            visible = kunde.instrumentLines.some(line => activeInstrumentLineFilters.has(line));
        }
        
        // Team-Filter: Nur prüfen wenn Filter aktiv ist
        if (isTeamFilterActive) {
            // Filter ist aktiv: Prüfe ob Team passt (mit flexiblem Matching)
            if (kunde.fieldServiceManager && kunde.fieldServiceManager.trim()) {
                const customerFSM = kunde.fieldServiceManager.trim().toLowerCase();
                
                // Prüfe ob IRGENDEIN aktiver RSL-Filter im FSM-Namen vorkommt
                // z.B. "Ghaderi" matcht "Aydin Ghaderi"
                let teamMatches = false;
                for (const rsl of activeRSLFilters) {
                    const rslLower = rsl.toLowerCase();
                    if (customerFSM.includes(rslLower) || rslLower.includes(customerFSM)) {
                        teamMatches = true;
                        break;
                    }
                }
                
                visible = visible && teamMatches;
            } else {
                // Kunde hat KEIN Team: Wenn InstrumentLine passt, zeige ihn trotzdem
                // (visible bleibt wie es ist - basiert nur auf InstrumentLine)
            }
        }
        // Wenn Team-Filter NICHT aktiv: visible basiert nur auf InstrumentLine
        
        kunde.visible = visible;
    });
    
    // Isochronen entsprechend filtern
    isochroneLayers.forEach(isoLayer => {
        const tech = techniker.find(t => t.id === isoLayer.techId);
        if (tech) {
            // Isochrone nur anzeigen wenn:
            // 1. Techniker durch Filter sichtbar ist (tech.visible)
            // 2. Techniker den richtigen Status hat (shouldShowIsochrone)
            const shouldShow = tech.visible !== false && shouldShowIsochrone(tech);
            
            if (shouldShow && !map.hasLayer(isoLayer.layer)) {
                // Einblenden
                map.addLayer(isoLayer.layer);
            } else if (!shouldShow && map.hasLayer(isoLayer.layer)) {
                // Ausblenden
                map.removeLayer(isoLayer.layer);
            }
        }
    });
    
    // Marker und Liste aktualisieren
    updateAllMarkers();
    updateUI();
    
    // Assignment-Panel aktualisieren falls aktiv
    if (assignmentMode) {
        refreshAssignmentPanel();
    }
    
    // Analyse aktualisieren falls offen - modus-abhängig
    const analysisPanel = document.getElementById('analysisPanel');
    
    if (analysisPanel && analysisPanel.classList.contains('active')) {
        if (appMode === 'strategy') {
            // Im Strategiemodus: Karte und Analyse aktualisieren
            checkCustomerCoverageStrategy();
            calculateStrategyAnalysis();
        } else {
            // Im Kalendermodus: Tagesanalyse aktualisieren
            calculateDayAnalysis();
        }
    }
}

// ===== EXPORT/IMPORT FUNKTIONEN =====

// Isochronen von der API laden und speichern
async function loadIsochrones() {
    if (!apiKey) {
        alert('❌ Bitte zuerst einen OpenRouteService API Key eingeben!');
        return;
    }
    
    const activeTechs = techniker.filter(t => t.active);
    
    if (activeTechs.length === 0) {
        alert('❌ Keine aktiven Techniker vorhanden!');
        return;
    }
    
    // Nur Techniker ohne gespeicherte Isochrone laden
    const techsWithoutIsochrones = activeTechs.filter(tech => {
        return !isochroneGeoJSON.find(iso => iso.techId === tech.id);
    });
    
    if (techsWithoutIsochrones.length === 0) {
        alert('✅ Alle aktiven Techniker haben bereits Isochronen!\n\n💡 Es gibt keine fehlenden Isochronen zum Laden.');
        return;
    }
    
    const confirmation = confirm(
        `📡 Fehlende Isochronen laden\n\n` +
        `Es werden Isochronen für ${techsWithoutIsochrones.length} Techniker von der API geladen.\n` +
        `${activeTechs.length - techsWithoutIsochrones.length} Techniker haben bereits gespeicherte Isochronen.\n\n` +
        `⚠️ Dies benötigt Internet und verwendet API-Requests.\n\n` +
        `Fortfahren?`
    );
    
    if (!confirmation) return;
    
    // Loading anzeigen
    const loadBtn = document.getElementById('loadIsochrones');
    const originalText = loadBtn.textContent;
    loadBtn.textContent = '⏳ Lade Isochronen...';
    loadBtn.disabled = true;
    
    try {
        console.log(`🌐 Lade Isochronen für ${techsWithoutIsochrones.length} Techniker...`);
        
        // Isochronen für Techniker ohne Isochronen erstellen (mit kleiner Verzögerung)
        const results = [];
        for (let i = 0; i < techsWithoutIsochrones.length; i++) {
            const tech = techsWithoutIsochrones[i];
            loadBtn.textContent = `⏳ Lade ${i + 1}/${techsWithoutIsochrones.length}...`;
            
            const result = await fetchIsochrone(tech.lat, tech.lng, tech.name);
            results.push(result);
            
            // Kleine Pause zwischen Requests (Rate-Limiting vermeiden)
            if (i < techsWithoutIsochrones.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // Kritische Fehler behandeln (API Key, Rate Limit)
        const criticalError = results.find(r => !r.success && r.critical);
        if (criticalError) {
            if (criticalError.error === 'API Key ungültig') {
                alert(`❌ API Key Fehler!\n\nBitte überprüfen Sie Ihren OpenRouteService API Key.\n\nGehen Sie zu:\nhttps://openrouteservice.org/dev/#/home\num Ihren API Key zu überprüfen.`);
            } else if (criticalError.error === 'API Limit erreicht') {
                alert('❌ API Limit erreicht!\n\nSie haben das Tageslimit von 2000 Anfragen überschritten.\n\nBitte warten Sie bis morgen oder erstellen Sie einen neuen API Key.');
            }
            loadBtn.textContent = originalText;
            loadBtn.disabled = false;
            return;
        }
        
        // Erfolgreiche Isochronen zeichnen
        let successCount = 0;
        let failCount = 0;
        const failedTechs = [];
        
        results.forEach((result, index) => {
            if (result.success) {
                drawIsochrone(result.data, techsWithoutIsochrones[index].name, techsWithoutIsochrones[index].id, result.range);
                successCount++;
            } else {
                failCount++;
                failedTechs.push({ name: result.name, error: result.error });
            }
        });
        
        // Isochronen speichern für Offline-Nutzung (wenn mindestens eine erfolgreich war)
        if (successCount > 0) {
            saveToLocalStorage();
        }
        
        // Zusammenfassung erstellen
        let message = `✅ Isochronen geladen!\n\n`;
        message += `📊 Ergebnis:\n`;
        message += `✅ ${successCount} von ${techsWithoutIsochrones.length} Techniker erfolgreich\n`;
        
        if (failCount > 0) {
            message += `\n⚠️ ${failCount} Techniker fehlgeschlagen:\n`;
            failedTechs.forEach(ft => {
                message += `• ${ft.name}: ${ft.error}\n`;
            });
            message += `\n💡 Tipp: Überprüfen Sie die Koordinaten der fehlgeschlagenen Techniker.`;
        } else {
            message += `\n💾 Isochronen wurden gespeichert!\n`;
            message += `\n🔍 Klicken Sie jetzt auf "Analyse durchführen" um die Kundenabdeckung zu prüfen.`;
        }
        
        alert(message);
        
    } catch (error) {
        console.error('Fehler beim Laden der Isochronen:', error);
        alert('❌ Fehler beim Laden der Isochronen:\n\n' + error.message);
    } finally {
        loadBtn.textContent = originalText;
        loadBtn.disabled = false;
    }
}

// Einzelne Isochrone für einen Techniker laden
async function loadIsochroneForTechniker(tech) {
    if (!apiKey) {
        alert('❌ Bitte zuerst einen OpenRouteService API Key eingeben!');
        return false;
    }
    
    console.log(`🌐 Lade Isochrone für ${tech.name}...`);
    
    try {
        const result = await fetchIsochrone(tech.lat, tech.lng, tech.name);
        
        if (result.success) {
            drawIsochrone(result.data, tech.name, tech.id, result.range);
            saveToLocalStorage();
            console.log(`✅ Isochrone für ${tech.name} erfolgreich geladen`);
            return true;
        } else {
            alert(`❌ Fehler beim Laden der Isochrone für ${tech.name}:\n\n${result.error}\n\n💡 Tipp: Überprüfen Sie die Koordinaten.`);
            return false;
        }
    } catch (error) {
        console.error('Fehler beim Laden der Isochrone:', error);
        alert('❌ Fehler beim Laden der Isochrone:\n\n' + error.message);
        return false;
    }
}

// Analyse durchführen (nutzt gespeicherte Isochronen)
async function performAnalysis() {
    // Im Strategiemodus: Alle Techniker verwenden
    // Im Kalendermodus: Nur aktive Techniker (mit ZR-Status)
    const activeTechs = appMode === 'strategy' 
        ? techniker.filter(t => t.visible) // Strategie: respektiere nur Sichtbarkeit/Filter
        : techniker.filter(t => t.active);  // Kalender: respektiere ZR-Status
    
    if (activeTechs.length === 0) {
        const modeMsg = appMode === 'strategy' 
            ? '❌ Keine sichtbaren Techniker vorhanden!' 
            : '❌ Keine aktiven Techniker mit Status ZR vorhanden!';
        alert(modeMsg);
        return;
    }
    
    if (kunden.length === 0) {
        alert('❌ Keine Kunden vorhanden!');
        return;
    }
    
    // Prüfen ob Isochronen vorhanden sind
    if (isochroneGeoJSON.length === 0) {
        alert('❌ Keine Isochronen vorhanden!\n\n📡 Bitte zuerst auf "Fehlende Isochronen laden" klicken.');
        return;
    }
    
    // Prüfen ob die Isochronen zu den aktuellen Technikern passen
    if (!checkIfCachedIsochronesMatchTechs(activeTechs)) {
        alert(
            '⚠️ Warnung\n\n' +
            'Die gespeicherten Isochronen passen nicht zu den aktuellen Technikern.\n\n' +
            'Bitte klicken Sie auf "Fehlende Isochronen laden" um die fehlenden Isochronen zu ergänzen.'
        );
        return;
    }
    
    // Loading anzeigen
    const analyzeBtn = document.getElementById('analyzeButton');
    const originalText = analyzeBtn.textContent;
    analyzeBtn.textContent = '⏳ Analysiere...';
    analyzeBtn.disabled = true;
    
    try {
        console.log(`📦 Führe Analyse durch im ${appMode === 'strategy' ? 'Strategiemodus' : 'Kalendermodus'} mit ${activeTechs.length} Technikern`);
        
        // Alte Layer entfernen (Cache behalten!)
        clearIsochrones(true);
        
        // Gecachte Isochronen wiederherstellen
        restoreIsochronesFromCache();
        
        // Prüfen welche Kunden abgedeckt sind
        checkCustomerCoverage();
        
        // UI aktualisieren
        updateAllMarkers();
        updateStatistics();
        
        const coveredCount = kunden.filter(k => k.covered).length;
        const totalCount = kunden.length;
        
        const modeInfo = appMode === 'strategy' 
            ? `🎯 Strategiemodus: ${activeTechs.length} Techniker analysiert`
            : `📅 Kalendermodus: ${activeTechs.length} Techniker mit ZR-Status`;
        
        alert(
            `✅ Analyse abgeschlossen!\n\n` +
            `📊 Ergebnis:\n` +
            `✅ ${coveredCount} von ${totalCount} Kunden abgedeckt\n` +
            `❌ ${totalCount - coveredCount} Kunden nicht abgedeckt\n\n` +
            `${modeInfo}\n` +
            `📦 Offline-Modus verwendet`
        );
        
    } catch (error) {
        console.error('Analyse Fehler:', error);
        alert('❌ Fehler bei der Analyse:\n\n' + error.message);
    } finally {
        analyzeBtn.textContent = originalText;
        analyzeBtn.disabled = false;
    }
}

// Analyse durchführen ohne Alerts (für Moduswechsel)
function performAnalysisSilent() {
    // Im Strategiemodus: Alle sichtbaren Techniker verwenden
    // Im Kalendermodus: Nur aktive Techniker (mit ZR-Status)
    const activeTechs = appMode === 'strategy' 
        ? techniker.filter(t => t.visible) 
        : techniker.filter(t => t.active);
    
    if (activeTechs.length === 0 || kunden.length === 0 || isochroneGeoJSON.length === 0) {
        console.log(`⚠️ Analyse übersprungen: ${activeTechs.length} Techniker, ${kunden.length} Kunden, ${isochroneGeoJSON.length} Isochronen`);
        return;
    }
    
    try {
        console.log(`📦 Führe stille Analyse durch (${appMode === 'strategy' ? 'Strategiemodus' : 'Kalendermodus'}) mit ${activeTechs.length} Technikern...`);
        
        // Alte Layer entfernen (Cache behalten!)
        clearIsochrones(true);
        
        // Gecachte Isochronen wiederherstellen
        restoreIsochronesFromCache();
        
        // Prüfen welche Kunden abgedeckt sind (modus-abhängig)
        if (appMode === 'strategy') {
            checkCustomerCoverageStrategy();
        } else {
            checkCustomerCoverage();
        }
        
        // UI aktualisieren
        updateAllMarkers();
        updateStatistics();
        
        const coveredCount = kunden.filter(k => k.covered).length;
        console.log(`✅ Stille Analyse: ${coveredCount}/${kunden.length} Kunden abgedeckt`);
        
    } catch (error) {
        console.error('Stille Analyse Fehler:', error);
    }
}

// Isochrone von OpenRouteService abrufen (mit Retry-Mechanismus)
async function fetchIsochrone(lat, lng, name, retries = 3) {
    // Koordinaten validieren
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        console.error(`   ❌ Ungültige Koordinaten für ${name}: ${lat}, ${lng}`);
        return { success: false, error: 'Ungültige Koordinaten', name: name };
    }
    
    // Ausgewählte Reichweite aus Radio-Buttons lesen
    const selectedRange = document.querySelector('input[name="isochroneRange"]:checked');
    const rangeValue = selectedRange ? parseInt(selectedRange.value) : 3600; // Default: 1 Stunde
    const rangeLabel = rangeValue === 3600 ? '1h' : '2h';
    
    console.log(`📡 Lade Isochrone für ${name} (${lat}, ${lng}) mit ${rangeLabel} Reichweite... (Versuch ${4 - retries}/3)`);
    
    // Lokaler CORS-Proxy für localhost (Port 8001)
    const USE_LOCAL_PROXY = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const LOCAL_PROXY = 'http://localhost:8001';
    
    const baseUrl = 'https://api.openrouteservice.org/v2/isochrones/driving-car';
    const url = USE_LOCAL_PROXY ? LOCAL_PROXY : baseUrl;
    
    if (USE_LOCAL_PROXY) {
        console.log(`   🔄 Using local CORS proxy (Port 8001)`);
    }
    
    const body = {
        locations: [[lng, lat]], // ORS verwendet lng,lat!
        range: [rangeValue], // Dynamisch: 3600 Sekunden = 1h, 7200 = 2h
        range_type: 'time',
        attributes: ['area', 'reachfactor']
    };
    
    try {
        console.log(`   Request Body:`, body);
        console.log(`   API Key (erste 10 Zeichen): ${apiKey.substring(0, 10)}...`);
        console.log(`   API URL: ${url}`);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8'
            },
            body: JSON.stringify(body)
        });
        
        console.log(`   Response Status: ${response.status}`);
        console.log(`   Response Headers:`, [...response.headers.entries()]);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`   ❌ API Fehler ${response.status}:`, errorText);
            
            // Bei Rate-Limiting oder temporären Fehlern: Retry
            if (response.status === 429 || response.status >= 500) {
                if (retries > 0) {
                    const waitTime = (4 - retries) * 2000; // 2s, 4s, 6s
                    console.log(`   ⏳ Warte ${waitTime/1000}s und versuche es erneut...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    return fetchIsochrone(lat, lng, name, retries - 1);
                }
            }
            
            // Spezifische Fehlermeldungen (nur beim ersten Techniker)
            if (response.status === 401 || response.status === 403) {
                return { 
                    success: false, 
                    error: 'API Key ungültig', 
                    name: name,
                    critical: true 
                };
            } else if (response.status === 429) {
                return { 
                    success: false, 
                    error: 'API Limit erreicht', 
                    name: name,
                    critical: true 
                };
            }
            
            return { 
                success: false, 
                error: `API Fehler ${response.status}`, 
                name: name 
            };
        }
        
        const data = await response.json();
        console.log(`   ✅ Isochrone für ${name} geladen:`, data);
        
        // Validierung
        if (!data.features || data.features.length === 0) {
            console.warn(`   ⚠️ Keine Isochronen-Features für ${name} erhalten`);
            return { 
                success: false, 
                error: 'Keine Features erhalten', 
                name: name,
                range: rangeValue
            };
        }
        
        return { success: true, data: data, name: name, range: rangeValue };
        
    } catch (error) {
        console.error(`   ❌ Fehler beim Abrufen der Isochrone für ${name}:`, error);
        
        // Bei Netzwerkfehlern: Retry
        if (retries > 0 && (error.name === 'NetworkError' || error.message.includes('fetch'))) {
            const waitTime = (4 - retries) * 1000;
            console.log(`   ⏳ Netzwerkfehler - warte ${waitTime/1000}s und versuche es erneut...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return fetchIsochrone(lat, lng, name, retries - 1);
        }
        
        return { 
            success: false, 
            error: error.message || 'Netzwerkfehler', 
            name: name 
        };
    }
}

// Isochrone auf Karte zeichnen
function drawIsochrone(isochroneData, name, techId, range = 3600) {
    if (!isochroneData || !isochroneData.features || isochroneData.features.length === 0) {
        console.warn(`⚠️ Keine Features zum Zeichnen für ${name}`);
        return;
    }
    
    const rangeHours = range === 3600 ? '1h' : '2h';
    console.log(`🎨 Zeichne Isochrone für ${name} (ID: ${techId}) mit ${rangeHours} Reichweite...`);
    
    const feature = isochroneData.features[0];
    console.log(`   Feature Geometry Type:`, feature.geometry.type);
    console.log(`   Coordinates:`, feature.geometry.coordinates);
    
    // GeoJSON für Coverage-Check speichern
    isochroneGeoJSON.push({
        name: name,
        techId: techId,
        feature: feature,
        range: range // Speichere auch die Reichweite
    });
    
    // Zufällige Farbe für bessere Unterscheidung
    const colors = [
        { border: '#3498db', fill: '#3498db' },  // Blau
        { border: '#2ecc71', fill: '#2ecc71' },  // Grün
        { border: '#e74c3c', fill: '#e74c3c' },  // Rot
        { border: '#f39c12', fill: '#f39c12' },  // Orange
        { border: '#9b59b6', fill: '#9b59b6' },  // Lila
        { border: '#1abc9c', fill: '#1abc9c' },  // Türkis
        { border: '#34495e', fill: '#34495e' }   // Dunkelgrau
    ];
    
    const colorIndex = isochroneLayers.length % colors.length;
    const color = colors[colorIndex];
    
    // Reichweite für Anzeige
    const rangeLabel = range === 3600 ? '1 Stunde' : '2 Stunden';
    const dashArray = range === 7200 ? '10, 10' : null; // Gestrichelt für 2h
    
    // GeoJSON Layer erstellen
    const layer = L.geoJSON(feature, {
        style: {
            color: color.border,
            weight: 3,
            opacity: 0.8,
            fillColor: color.fill,
            fillOpacity: 0.15,
            dashArray: dashArray // Gestrichelt für 2h, durchgezogen für 1h
        }
    }).bindPopup(`
        <div class="popup-title">Einzugsgebiet: ${name}</div>
        <div class="popup-info">⏱️ ${rangeLabel} Fahrzeit</div>
        <div class="popup-info">📍 Aktiver Bereich</div>
    `);
    
    // Hover-Effekt hinzufügen
    layer.on('mouseover', function(e) {
        const hoveredLayer = e.target;
        hoveredLayer.setStyle({
            weight: 5,
            opacity: 1,
            fillOpacity: 0.35
        });
        
        // Tooltip mit Techniker-Name anzeigen
        hoveredLayer.bindTooltip(`<strong>🧑‍🔧 ${name}</strong>`, {
            permanent: false,
            sticky: true,
            className: 'isochrone-tooltip'
        }).openTooltip(e.latlng);
    });
    
    layer.on('mouseout', function(e) {
        const hoveredLayer = e.target;
        hoveredLayer.setStyle({
            weight: 3,
            opacity: 0.8,
            fillOpacity: 0.15
        });
        hoveredLayer.closeTooltip();
    });
    
    // Prüfen ob Isochrone angezeigt werden soll
    // 1. Techniker durch Filter sichtbar ist (tech.visible)
    // 2. Techniker den richtigen Status hat (shouldShowIsochrone)
    const tech = techniker.find(t => t.id === techId);
    if (tech && tech.visible !== false && shouldShowIsochrone(tech)) {
        layer.addTo(map);
    }
    
    isochroneLayers.push({ techId: techId, layer: layer, name: name, color: color });
    console.log(`   ✅ Isochrone für ${name} gezeichnet (${isochroneLayers.length} gesamt)`);
}

// Alte Isochronen entfernen
function clearIsochrones(keepCachedData = false) {
    console.log(`🧹 Entferne ${isochroneLayers.length} alte Isochronen...`);
    isochroneLayers.forEach(item => {
        map.removeLayer(item.layer);
    });
    isochroneLayers = [];
    
    // Gecachte Daten nur löschen wenn explizit gewünscht
    if (!keepCachedData) {
        isochroneGeoJSON = [];
        console.log('   ✅ Alle Isochronen und Cache entfernt');
    } else {
        console.log('   ✅ Isochronen-Layer entfernt (Cache behalten)');
    }
}

// Gecachte Isochronen von der Karte wiederherstellen
function restoreIsochronesFromCache() {
    console.log(`🔄 Stelle ${isochroneGeoJSON.length} gecachte Isochronen wieder her...`);
    
    isochroneGeoJSON.forEach((isoData, index) => {
        const feature = isoData.feature;
        const name = isoData.name;
        const techId = isoData.techId;
        
        // Finde den Techniker
        const tech = techniker.find(t => t.id === techId);
        if (!tech) {
            console.warn(`   ⚠️ Techniker mit ID ${techId} nicht gefunden`);
            return;
        }
        
        // Farbe für Isochrone
        const colors = [
            { border: '#3498db', fill: '#3498db' },
            { border: '#2ecc71', fill: '#2ecc71' },
            { border: '#e74c3c', fill: '#e74c3c' },
            { border: '#f39c12', fill: '#f39c12' },
            { border: '#9b59b6', fill: '#9b59b6' },
            { border: '#1abc9c', fill: '#1abc9c' },
            { border: '#34495e', fill: '#34495e' }
        ];
        
        const colorIndex = index % colors.length;
        const color = colors[colorIndex];
        
        // GeoJSON Layer erstellen
        const layer = L.geoJSON(feature, {
            style: {
                color: color.border,
                weight: 3,
                opacity: 0.8,
                fillColor: color.fill,
                fillOpacity: 0.15
            }
        }).bindPopup(`
            <div class="popup-title">Einzugsgebiet: ${name}</div>
            <div class="popup-info">⏱️ 1 Stunde Fahrzeit</div>
            <div class="popup-info">📍 Aktiver Bereich</div>
            <div class="popup-info">💾 Aus Cache</div>
        `);
        
        // Hover-Effekt hinzufügen
        layer.on('mouseover', function(e) {
            const hoveredLayer = e.target;
            hoveredLayer.setStyle({
                weight: 5,
                opacity: 1,
                fillOpacity: 0.35
            });
            
            hoveredLayer.bindTooltip(`<strong>🧑‍🔧 ${name}</strong>`, {
                permanent: false,
                sticky: true,
                className: 'isochrone-tooltip'
            }).openTooltip(e.latlng);
        });
        
        layer.on('mouseout', function(e) {
            const hoveredLayer = e.target;
            hoveredLayer.setStyle({
                weight: 3,
                opacity: 0.8,
                fillOpacity: 0.15
            });
            hoveredLayer.closeTooltip();
        });
        
        // Nur hinzufügen wenn:
        // 1. Techniker durch Filter sichtbar ist (tech.visible)
        // 2. Techniker den richtigen Status hat (shouldShowIsochrone)
        if (tech.visible !== false && shouldShowIsochrone(tech)) {
            layer.addTo(map);
        }
        
        isochroneLayers.push({ techId: techId, layer: layer, name: name, color: color });
    });
    
    console.log(`   ✅ ${isochroneLayers.length} Isochronen wiederhergestellt`);
}

// Prüfen ob gecachte Isochronen mit aktuellen Technikern übereinstimmen
function checkIfCachedIsochronesMatchTechs(activeTechs) {
    // Wenn keine gecachten Isochronen vorhanden sind
    if (isochroneGeoJSON.length === 0) {
        return false;
    }
    
    // Prüfen ob alle aktiven Techniker im Cache sind
    // (Es ist OK wenn mehr Isochronen vorhanden sind, z.B. von inaktiven Technikern)
    for (const tech of activeTechs) {
        const found = isochroneGeoJSON.find(iso => iso.techId === tech.id);
        if (!found) {
            console.log(`   ℹ️ Techniker ${tech.name} (ID: ${tech.id}) hat keine gespeicherte Isochrone`);
            return false;
        }
    }
    
    console.log(`   ✅ Alle ${activeTechs.length} aktiven Techniker haben gespeicherte Isochronen`);
    return true;
}

// ✅ PERFORMANCE OPTIMIERT: Prüfen welche Kunden abgedeckt sind
function checkCustomerCoverage(isochrones) {
    console.log(`🔍 Prüfe Kundenabdeckung für ${kunden.length} Kunden...`);
    console.log(`   Verfügbare Isochronen: ${isochroneGeoJSON.length}`);
    
    if (isochroneGeoJSON.length === 0) {
        console.warn('   ⚠️ Keine Isochronen-Daten für Coverage-Check verfügbar');
        return;
    }
    
    // ✅ PERFORMANCE: Start timing
    const startTime = performance.now();
    console.time('Coverage Check');
    
    // ✅ PERFORMANCE: Baue Spatial Index - Gruppiere Isochronen nach Techniker
    const isochroneByTech = new Map();
    const activeZRTechs = new Set();
    
    const checkDate = selectedDate ? selectedDate : new Date();
    const dateStr = formatDate(checkDate);
    
    isochroneGeoJSON.forEach(iso => {
        const tech = techniker.find(t => t.name === iso.name);
        if (!tech || !tech.active || tech.visible === false) return;
        
        const techStatus = getScheduleStatus(tech.id, dateStr);
        if (techStatus !== 'ZR') return;
        
        activeZRTechs.add(tech.id);
        if (!isochroneByTech.has(tech.id)) {
            isochroneByTech.set(tech.id, {
                tech: tech,
                isochronen: []
            });
        }
        isochroneByTech.get(tech.id).isochronen.push(iso);
    });
    
    console.log(`📊 Spatial Index: ${activeZRTechs.size} aktive ZR-Techniker`);
    
    // ✅ PERFORMANCE: Baue Skill-Index für schnelleres Matching
    const techsBySkill = new Map();
    Array.from(isochroneByTech.values()).forEach(({ tech }) => {
        if (!tech.skills) return;
        tech.skills.forEach(skill => {
            const skillKey = skill.toLowerCase().trim();
            if (!techsBySkill.has(skillKey)) {
                techsBySkill.set(skillKey, []);
            }
            techsBySkill.get(skillKey).push(tech);
        });
    });
    
    let fullyCoveredCustomers = 0;
    let totalDevices = 0;
    let coveredDevices = 0;
    
    // ✅ PERFORMANCE: Batch-verarbeite Kunden
    kunden.forEach((kunde, index) => {
        // Progress-Logging alle 500 Kunden
        if (kunden.length > 500 && index % 500 === 0 && index > 0) {
            console.log(`   📊 Verarbeite Kunde ${index}/${kunden.length}...`);
        }
        
        // Ensure instrumentLines is an array
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        const allDevices = kunde.instrumentLines.filter(line => line && line.trim());
        const devices = allDevices.filter(line => activeInstrumentLineFilters.has(line));
        
        if (devices.length === 0) {
            kunde.covered = false;
            kunde.coveredDevices = 0;
            kunde.totalDevices = 0;
            return;
        }
        
        totalDevices += devices.length;
        kunde.totalDevices = devices.length;
        kunde.coveredDevicesList = [];
        
        // ✅ PERFORMANCE: Prüfe jedes Gerät mit optimiertem Lookup
        devices.forEach(instrumentLine => {
            const instrumentName = instrumentLine.toLowerCase();
            let deviceCovered = false;
            
            // Finde passende Techniker via Skill-Index (statt alle durchgehen)
            const matchingTechs = new Set();
            
            // Durchsuche Skills
            for (const [skillKey, techs] of techsBySkill.entries()) {
                const escapedSkill = skillKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
                
                if (regex.test(instrumentName)) {
                    techs.forEach(t => matchingTechs.add(t.id));
                }
            }
            
            // ✅ Nur relevante Techniker prüfen (statt alle 150)
            for (const techId of matchingTechs) {
                if (!isochroneByTech.has(techId)) continue;
                
                const { tech, isochronen } = isochroneByTech.get(techId);
                
                // Prüfe Isochronen dieses Technikers
                for (const iso of isochronen) {
                    if (isPointInPolygon(kunde.lng, kunde.lat, iso.feature.geometry)) {
                        deviceCovered = true;
                        kunde.coveredDevicesList.push(instrumentLine);
                        break; // Gerät ist abgedeckt, nächstes Gerät
                    }
                }
                
                if (deviceCovered) break; // Gerät ist abgedeckt
            }
        });
        
        kunde.coveredDevices = kunde.coveredDevicesList.length;
        coveredDevices += kunde.coveredDevices;
        kunde.covered = kunde.coveredDevices === kunde.totalDevices;
        
        if (kunde.covered) {
            fullyCoveredCustomers++;
        }
    });
    
    const duration = performance.now() - startTime;
    console.timeEnd('Coverage Check');
    console.log(`⚡ Performance: ${duration.toFixed(0)}ms`);
    logPerformance('coverageChecks', duration);
    
    const deviceCoveragePercent = totalDevices > 0 ? ((coveredDevices / totalDevices) * 100).toFixed(1) : 0;
    console.log(`📊 Ergebnis: ${coveredDevices}/${totalDevices} Geräte abgedeckt (${deviceCoveragePercent}%)`);
    console.log(`📊 Vollständig abgedeckte Kunden: ${fullyCoveredCustomers}/${kunden.length}`);
    
    saveToLocalStorage();
}

// Robuster Point-in-Polygon Test (Ray-Casting Algorithmus)
function isPointInPolygon(pointX, pointY, geometry) {
    // Unterstützt Polygon und MultiPolygon
    if (geometry.type === 'Polygon') {
        return isPointInPolygonRing(pointX, pointY, geometry.coordinates[0]);
    } else if (geometry.type === 'MultiPolygon') {
        for (const polygon of geometry.coordinates) {
            if (isPointInPolygonRing(pointX, pointY, polygon[0])) {
                return true;
            }
        }
    }
    return false;
}

// Ray-Casting Algorithmus für einen Polygon-Ring
function isPointInPolygonRing(x, y, ring) {
    let inside = false;
    
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        
        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        
        if (intersect) inside = !inside;
    }
    
    return inside;
}

// ✅ PERFORMANCE: Debounced Version der Coverage-Funktion
// Wird verwendet bei Filter-Änderungen, Datum-Wechsel etc. 
// NICHT verwendet bei initialem Laden oder Export/PDF
const debouncedCoverageCheck = debounce(checkCustomerCoverage, 500);

// Daten in LocalStorage speichern
function saveToLocalStorageOld() {
    // Legacy - wird nicht mehr verwendet
    const data = {
        techniker: techniker,
        kunden: kunden,
        isochroneData: isochroneGeoJSON, // Isochrone-Daten für Offline-Nutzung speichern
        schedule: schedule // Dienstplan speichern
    };
    localStorage.setItem('techniker_app_data', JSON.stringify(data));
}

// Async Daten laden (aus IndexedDB mit Fallback zu LocalStorage)
async function loadFromLocalStorageAsync() {
    // API Key laden (bleibt in localStorage - ist klein)
    const savedApiKey = localStorage.getItem('ors_api_key');
    if (savedApiKey) {
        apiKey = savedApiKey;
        document.getElementById('apiKey').value = savedApiKey;
        showStatus('apiStatus', 'API Key geladen', 'success');
    }
    
    // OpenAI API Key laden
    const savedOpenAIKey = localStorage.getItem('openai_api_key');
    if (savedOpenAIKey) {
        openaiApiKey = savedOpenAIKey;
        document.getElementById('openaiApiKey').value = savedOpenAIKey;
        showStatus('openaiStatus', 'OpenAI API Key geladen', 'success');
    }
    
    // Versuche zuerst aus IndexedDB zu laden
    let data = null;
    try {
        data = await loadFromIndexedDB();
    } catch (error) {
        console.error('IndexedDB Laden fehlgeschlagen:', error);
    }
    
    // Fallback: LocalStorage (für Migration alter Daten)
    if (!data) {
        const savedData = localStorage.getItem('techniker_app_data');
        if (savedData) {
            try {
                data = JSON.parse(savedData);
                console.log('📦 Daten aus LocalStorage migriert');
                // Nach erfolgreicher Migration: LocalStorage leeren und in IndexedDB speichern
                localStorage.removeItem('techniker_app_data');
            } catch (error) {
                console.error('LocalStorage Parse-Fehler:', error);
            }
        }
    }
    
    if (data) {
        try {
            techniker = data.techniker || [];
            kunden = data.kunden || [];
            
            // Gespeicherte Isochronen-Daten laden
            if (data.isochroneData && Array.isArray(data.isochroneData)) {
                isochroneGeoJSON = data.isochroneData;
                console.log(`📦 ${isochroneGeoJSON.length} gespeicherte Isochronen geladen`);
            }
            
            // Dienstplan laden
            if (data.schedule) {
                schedule = data.schedule;
                console.log('📅 Dienstplan geladen');
            }
            
            // Gerätegewichtungen laden
            if (data.deviceWeights) {
                deviceWeights = data.deviceWeights;
                console.log('⚖️ Gerätegewichtungen geladen');
            }
            
            // Überlastungsgrenze laden
            if (data.overloadThreshold !== undefined) {
                overloadThreshold = data.overloadThreshold;
                console.log(`⚖️ Überlastungsgrenze geladen: ${overloadThreshold.toFixed(1)} GE`);
            }
            
            // Strafgewicht laden
            if (data.penaltyWeight !== undefined) {
                penaltyWeight = data.penaltyWeight;
                console.log(`⚖️ Strafgewicht geladen: ${penaltyWeight.toFixed(3)}`);
            }
            
            // Sicherstellen dass alle Objekte die neuen Properties haben
            techniker.forEach(tech => {
                if (!tech.skills) tech.skills = [];
                if (tech.visible === undefined) tech.visible = true;
            });
            
            kunden.forEach(kunde => {
                if (!Array.isArray(kunde.instrumentLines)) {
                    if (kunde.instrumentLineName) {
                        kunde.instrumentLines = [kunde.instrumentLineName];
                    } else {
                        kunde.instrumentLines = [];
                    }
                }
                if (kunde.visible === undefined) kunde.visible = true;
                
                // Assignment System: Migrate to new deviceKey format with indices
                try {
                    if (!kunde.deviceAssignments) {
                        kunde.deviceAssignments = {};
                    }
                    
                    // Migrate old format 1: assignedTechnicianIds (very old)
                    if (kunde.assignedTechnicianIds && kunde.assignedTechnicianIds.length > 0) {
                        console.log(`Migrating old assignedTechnicianIds for ${kunde.name}`);
                        const techId = kunde.assignedTechnicianIds[0];
                        const deviceIndices = {};
                        
                        kunde.instrumentLines.forEach(device => {
                            if (!device) return;
                            const trimmedDevice = device.trim();
                            
                            if (!deviceIndices[trimmedDevice]) {
                                deviceIndices[trimmedDevice] = 0;
                            }
                            const deviceIndex = deviceIndices[trimmedDevice];
                            deviceIndices[trimmedDevice]++;
                            
                            const deviceKey = `${trimmedDevice}_${deviceIndex}`;
                            if (!kunde.deviceAssignments[deviceKey]) {
                                kunde.deviceAssignments[deviceKey] = techId;
                            }
                        });
                        delete kunde.assignedTechnicianIds;
                    }
                    
                    // Migrate old format 2: deviceAssignments without indices (e.g., { "Pro": techId })
                    // Check if any keys don't have the _index format
                    const allKeys = Object.keys(kunde.deviceAssignments);
                    const oldKeys = allKeys.filter(key => !key.match(/_\d+$/)); // Keys that don't end with _number
                    
                    if (oldKeys.length > 0) {
                        console.log(`Migrating old deviceAssignments for ${kunde.name}, old keys: ${oldKeys.join(', ')}`);
                        const newAssignments = {};
                        const deviceIndices = {};
                        
                        kunde.instrumentLines.forEach(device => {
                            if (!device) return;
                            const trimmedDevice = device.trim();
                            
                            // Check if this device type has an old-style assignment
                            const oldTechId = kunde.deviceAssignments[trimmedDevice];
                            
                            if (!deviceIndices[trimmedDevice]) {
                                deviceIndices[trimmedDevice] = 0;
                            }
                            const deviceIndex = deviceIndices[trimmedDevice];
                            deviceIndices[trimmedDevice]++;
                            
                            const deviceKey = `${trimmedDevice}_${deviceIndex}`;
                            
                            // Migrate: assign all instances of this device type to the same technician
                            if (oldTechId !== undefined && oldTechId !== null) {
                                newAssignments[deviceKey] = oldTechId;
                            }
                        });
                        
                        // Replace old assignments with new ones
                        kunde.deviceAssignments = newAssignments;
                        console.log(`Migration completed for ${kunde.name}:`, kunde.deviceAssignments);
                    }
                } catch (migrationError) {
                    console.error(`⚠️ Migration error for customer ${kunde.name}:`, migrationError);
                    // Initialize empty on error
                    kunde.deviceAssignments = {};
                }
            });
            
            // Filter initialisieren
            updateFilters();
            
            // Device weights UI aktualisieren
            updateDeviceWeightsUI();
            
            // Marker hinzufügen
            techniker.forEach(tech => addTechnikerMarker(tech));
            kunden.forEach(kunde => addKundeMarker(kunde));
            
            // Karte zentrieren wenn Daten vorhanden
            if (techniker.length > 0) {
                const firstTech = techniker[0];
                map.setView([firstTech.lat, firstTech.lng], 8);
            }
            
            // Nach dem Laden in IndexedDB speichern (für Migration)
            saveToLocalStorage();
            
            console.log(`✅ Geladen: ${techniker.length} Techniker, ${kunden.length} Kunden`);
        } catch (error) {
            console.error('Fehler beim Verarbeiten der Daten:', error);
        }
    }
}

// Daten aus LocalStorage laden (Legacy - wird von loadFromLocalStorageAsync ersetzt)
function loadFromLocalStorage() {
    // Diese Funktion wird jetzt nur noch für Rückwärtskompatibilität aufgerufen
    // Die echte Arbeit macht loadFromLocalStorageAsync()
    console.log('⚠️ loadFromLocalStorage() aufgerufen - verwende stattdessen loadFromLocalStorageAsync()');
}

// Daten exportieren
function exportData() {
    const data = {
        techniker: techniker,
        kunden: kunden,
        isochroneData: isochroneGeoJSON, // Isochronen mit exportieren!
        deviceWeights: deviceWeights, // Gerätegewichtungen mit exportieren
        overloadThreshold: overloadThreshold, // Überlastungsgrenze mit exportieren
        penaltyWeight: penaltyWeight, // Strafgewicht mit exportieren
        exportDate: new Date().toISOString(),
        version: '1.0'
    };
    
    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `techniker-daten-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    URL.revokeObjectURL(url);
    
    // Bestätigungsmeldung
    const isoCount = isochroneGeoJSON.length;
    if (isoCount > 0) {
        alert(`✅ Export erfolgreich!\n\n📦 Exportiert:\n• ${techniker.length} Techniker\n• ${kunden.length} Kunden\n• ${isoCount} Isochronen\n\n💾 Die Datei enthält ALLE Daten inkl. Isochronen für Offline-Nutzung!`);
    } else {
        alert(`✅ Export erfolgreich!\n\n📦 Exportiert:\n• ${techniker.length} Techniker\n• ${kunden.length} Kunden\n\n⚠️ Keine Isochronen vorhanden.\nTipp: Zuerst "Isochronen laden" klicken!`);
    }
}

// Daten importieren
function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            
            if (data.techniker && data.kunden) {
                techniker = data.techniker;
                kunden = data.kunden;
                
                // Backward-Kompatibilität: Fehlende Felder initialisieren
                techniker.forEach(tech => {
                    if (!tech.skills) tech.skills = [];
                    if (tech.visible === undefined) tech.visible = true;
                });
                
                kunden.forEach(kunde => {
                    if (!Array.isArray(kunde.instrumentLines)) {
                        if (kunde.instrumentLineName) {
                            kunde.instrumentLines = [kunde.instrumentLineName];
                        } else {
                            kunde.instrumentLines = [];
                        }
                    }
                    if (kunde.visible === undefined) kunde.visible = true;
                    
                    // Assignment System: Migrate to new deviceKey format with indices
                    try {
                        if (!kunde.deviceAssignments) {
                            kunde.deviceAssignments = {};
                        }
                        
                        // Migrate old format 1: assignedTechnicianIds (very old)
                        if (kunde.assignedTechnicianIds && kunde.assignedTechnicianIds.length > 0) {
                            const techId = kunde.assignedTechnicianIds[0];
                            const deviceIndices = {};
                            
                            kunde.instrumentLines.forEach(device => {
                                if (!device) return;
                                const trimmedDevice = device.trim();
                                
                                if (!deviceIndices[trimmedDevice]) {
                                    deviceIndices[trimmedDevice] = 0;
                                }
                                const deviceIndex = deviceIndices[trimmedDevice];
                                deviceIndices[trimmedDevice]++;
                                
                                const deviceKey = `${trimmedDevice}_${deviceIndex}`;
                                if (!kunde.deviceAssignments[deviceKey]) {
                                    kunde.deviceAssignments[deviceKey] = techId;
                                }
                            });
                            delete kunde.assignedTechnicianIds;
                        }
                        
                        // Migrate old format 2: deviceAssignments without indices
                        const allKeys = Object.keys(kunde.deviceAssignments);
                        const oldKeys = allKeys.filter(key => !key.match(/_\d+$/));
                        
                        if (oldKeys.length > 0) {
                            const newAssignments = {};
                            const deviceIndices = {};
                            
                            kunde.instrumentLines.forEach(device => {
                                if (!device) return;
                                const trimmedDevice = device.trim();
                                
                                const oldTechId = kunde.deviceAssignments[trimmedDevice];
                                
                                if (!deviceIndices[trimmedDevice]) {
                                    deviceIndices[trimmedDevice] = 0;
                                }
                                const deviceIndex = deviceIndices[trimmedDevice];
                                deviceIndices[trimmedDevice]++;
                                
                                const deviceKey = `${trimmedDevice}_${deviceIndex}`;
                                
                                if (oldTechId !== undefined && oldTechId !== null) {
                                    newAssignments[deviceKey] = oldTechId;
                                }
                            });
                            
                            kunde.deviceAssignments = newAssignments;
                        }
                    } catch (migrationError) {
                        console.error(`⚠️ Migration error for customer ${kunde.name}:`, migrationError);
                        kunde.deviceAssignments = {};
                    }
                });
                
                // Isochronen importieren (falls vorhanden)
                if (data.isochroneData && Array.isArray(data.isochroneData)) {
                    isochroneGeoJSON = data.isochroneData;
                    console.log(`📦 ${isochroneGeoJSON.length} Isochronen importiert`);
                    
                    // Alte Layer entfernen und neue zeichnen
                    clearIsochrones(true); // Cache behalten
                    restoreIsochronesFromCache();
                }
                
                // Gerätegewichtungen importieren (falls vorhanden)
                if (data.deviceWeights) {
                    deviceWeights = data.deviceWeights;
                    console.log('⚖️ Gerätegewichtungen importiert');
                }
                
                // Überlastungsgrenze importieren (falls vorhanden)
                if (data.overloadThreshold !== undefined) {
                    overloadThreshold = data.overloadThreshold;
                    console.log(`⚖️ Überlastungsgrenze importiert: ${overloadThreshold.toFixed(1)} GE`);
                }
                
                // Strafgewicht importieren (falls vorhanden)
                if (data.penaltyWeight !== undefined) {
                    penaltyWeight = data.penaltyWeight;
                    console.log(`⚖️ Strafgewicht importiert: ${penaltyWeight.toFixed(3)}`);
                }
                
                saveToLocalStorage();
                updateAllMarkers();
                updateUI();
                updateFilters(); // Filter-UI erstellen
                applyFilters(); // Filter auf Daten anwenden
                updateDeviceWeightsUI();
                
                // Debug: Zeige Filter-Status
                console.log(`🔍 Nach Import - Filter-Status:`);
                console.log(`   RSL-Filter: ${Array.from(activeRSLFilters).join(', ')}`);
                console.log(`   Sichtbare Techniker: ${techniker.filter(t => t.visible !== false).length}/${techniker.length}`);
                console.log(`   Sichtbare Kunden: ${kunden.filter(k => k.visible !== false).length}/${kunden.length}`);
                
                // Zusammenfassung
                let message = '✅ Import erfolgreich!\n\n📦 Importiert:\n';
                message += `• ${techniker.length} Techniker\n`;
                message += `• ${kunden.length} Kunden\n`;
                if (data.isochroneData && data.isochroneData.length > 0) {
                    message += `• ${data.isochroneData.length} Isochronen\n\n`;
                    message += `🚀 Isochronen wurden geladen!\n`;
                    message += `Klicke jetzt auf "Analyse durchführen" um die Kundenabdeckung zu prüfen.`;
                } else {
                    message += `\n⚠️ Keine Isochronen in der Datei.\n`;
                    message += `Tipp: Zuerst auf dem anderen PC "Isochronen laden" klicken, dann exportieren!`;
                }
                
                alert(message);
                
                // Karte zentrieren
                if (techniker.length > 0) {
                    map.setView([techniker[0].lat, techniker[0].lng], 8);
                }
            } else {
                alert('❌ Ungültiges Dateiformat!');
            }
        } catch (error) {
            console.error('Import Fehler:', error);
            alert('❌ Fehler beim Importieren:\n\n' + error.message);
        }
    };
    reader.readAsText(file);
    
    // File input zurücksetzen
    e.target.value = '';
}

// ===== EXCEL IMPORT FUNKTIONEN =====

// Progress Modal öffnen
function showProgressModal() {
    document.getElementById('progressModal').style.display = 'block';
    document.getElementById('progressInfo').style.display = 'block';
    document.getElementById('progressComplete').style.display = 'none';
}

// Progress Modal schließen
function closeProgressModal() {
    document.getElementById('progressModal').style.display = 'none';
    updateAllMarkers();
    updateUI();
    
    // Karte zentrieren
    if (techniker.length > 0) {
        map.setView([techniker[0].lat, techniker[0].lng], 8);
    }
}

// Progress aktualisieren
function updateProgress(current, total, text, errors = []) {
    const percent = Math.round((current / total) * 100);
    document.getElementById('progressBar').style.width = percent + '%';
    document.getElementById('progressText').textContent = text;
    document.getElementById('progressCurrent').textContent = `${current} von ${total} verarbeitet (${percent}%)`;
    
    if (errors.length > 0) {
        document.getElementById('progressErrors').innerHTML = `<strong>⚠️ Fehler (${errors.length}):</strong><br>` + 
            errors.slice(0, 5).join('<br>') + 
            (errors.length > 5 ? `<br>... und ${errors.length - 5} weitere` : '');
    }
}

// Progress abschließen
function completeProgress(successCount, errorCount) {
    document.getElementById('progressInfo').style.display = 'none';
    document.getElementById('progressComplete').style.display = 'block';
    
    const message = `${successCount} Einträge erfolgreich importiert` + 
        (errorCount > 0 ? `\n${errorCount} Fehler (siehe Konsole für Details)` : '');
    
    document.getElementById('progressComplete').querySelector('p').innerHTML = 
        `<strong>Import abgeschlossen!</strong><br><br>${message.replace(/\n/g, '<br>')}`;
}

// Geocoding mit Nominatim (mit Delay für Rate-Limiting)
async function geocodeAddressBatch(address) {
    // Kurze Verzögerung innerhalb des Batches
    await new Promise(resolve => setTimeout(resolve, 300));
    
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=de&limit=1`,
            {
                headers: {
                    'User-Agent': 'TechnikerApp/1.0'
                }
            }
        );
        
        const data = await response.json();
        
        if (data && data.length > 0) {
            return {
                lat: parseFloat(data[0].lat),
                lng: parseFloat(data[0].lon),
                success: true
            };
        } else {
            return {
                success: false,
                error: 'Adresse nicht gefunden'
            };
        }
    } catch (error) {
        console.error('Geocoding Fehler:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ===== KALENDER EXCEL IMPORT =====

// Kalender Excel importieren
async function importCalendarExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    console.log('📅 Starte Kalender-Import...');
    
    showProgressModal();
    updateProgress(0, 100, 'Lese Excel-Datei...', []);
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            console.log('📊 Verfügbare Sheets:', workbook.SheetNames);
            
            // Verwende erstes verfügbares Sheet
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) {
                alert('❌ Fehler: Keine Sheets in der Excel-Datei gefunden!');
                closeProgressModal();
                return;
            }
            
            console.log(`📊 Verwende Sheet: "${sheetName}"`);
            
            // Sheet lesen
            const sheet = workbook.Sheets[sheetName];
            const sheetData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
            
            console.log(`📊 Sheet hat ${sheetData.length} Zeilen`);
            
            if (sheetData.length < 2) {
                alert('❌ Fehler: Excel-Datei hat zu wenige Zeilen!\n\nErwartet: Mindestens 2 Zeilen (Header + Daten)');
                closeProgressModal();
                return;
            }
            
            // Zeile 1 = Header mit Techniker-Namen
            const headerRow = sheetData[0];
            console.log('📊 Header-Zeile:', headerRow);
            console.log('👷 Anzahl Spalten:', headerRow.length);
            
            // Zeige erste paar Datenzeilen zur Debug
            console.log('📅 Erste Datenzeile:', sheetData[1]);
            if (sheetData.length > 2) {
                console.log('📅 Zweite Datenzeile:', sheetData[2]);
            }
            
            // Code-Mapping
            const codeMapping = {
                'ZR': 'ZR',
                'R': 'ZR',    // Regulär = Bereitschaft
                'I': 'I',
                'W': 'W',
                'K': 'K',
                'U': 'U',
                'X': 'X',
                'S': 'X',     // Seminar = Abwesend
                'E': 'X',     // Einarbeitung = Abwesend
                'M': 'X',     // Meeting = Abwesend
                'Z': 'X',     // Zusatztermin = Abwesend
                'AFZ': 'U',   // Altersfreizeit = Urlaub
                '': ''        // Leer = kein Status (nicht setzen)
            };
            
            // Techniker-Mapping: Spalten-Index → App-Techniker
            const techMapping = {};
            
            // Durchlaufe Header-Zeile ab Spalte 3 (Index 2) - da KW und Datum in Spalte 0 und 1 sind
            for (let colIndex = 2; colIndex < headerRow.length; colIndex++) {
                const excelName = headerRow[colIndex];
                
                if (!excelName || typeof excelName !== 'string') continue;
                
                const excelNameClean = excelName.trim().toLowerCase();
                
                // Ignoriere leere oder zu kurze Namen
                if (excelNameClean.length < 3) continue;
                
                // Ignoriere numerische Header
                if (!isNaN(parseInt(excelNameClean))) continue;
                
                // Suche passenden Techniker in der App
                const appTech = techniker.find(t => {
                    const appNameLower = t.name.toLowerCase();
                    
                    // Exakte Übereinstimmung
                    if (appNameLower === excelNameClean) return true;
                    
                    // Teilstring-Match (z.B. "Blankenhagen" in "Gerald Blankenhagen")
                    if (excelNameClean.includes(appNameLower) || appNameLower.includes(excelNameClean)) return true;
                    
                    // Nachname-Match (letztes Wort)
                    const excelLastName = excelNameClean.split(/\s+/).pop();
                    const appLastName = appNameLower.split(/\s+/).pop();
                    if (excelLastName === appLastName && excelLastName.length > 3) return true;
                    
                    return false;
                });
                
                if (appTech) {
                    techMapping[colIndex] = appTech;
                    const colLetter = String.fromCharCode(65 + colIndex); // A=65
                    console.log(`✅ Zuordnung: "${excelName}" (Spalte ${colLetter}/${colIndex}) → "${appTech.name}" (ID ${appTech.id})`);
                } else {
                    const colLetter = String.fromCharCode(65 + colIndex);
                    console.log(`⚠️ Kein Match für: "${excelName}" (Spalte ${colLetter}/${colIndex})`);
                }
            }
            
            console.log(`📋 ${Object.keys(techMapping).length} Techniker zugeordnet`);
            
            if (Object.keys(techMapping).length === 0) {
                alert('❌ Keine Techniker konnten zugeordnet werden!\n\nBitte stellen Sie sicher, dass die Techniker-Namen in der App mit denen im Excel übereinstimmen.\n\nErwartet: Header ab Spalte C mit Techniker-Namen');
                closeProgressModal();
                return;
            }
            
            // Daten importieren (ab Zeile 2, Spalte B = Datum)
            let importedDays = 0;
            let skippedDays = 0;
            const errors = [];
            
            for (let rowIndex = 1; rowIndex < sheetData.length; rowIndex++) { // Ab Zeile 2 (Index 1)
                const row = sheetData[rowIndex];
                
                // Spalte B = Datum (Index 1)
                const datumCell = row[1];
                if (!datumCell) {
                    skippedDays++;
                    continue;
                }
                
                // Datum parsen
                let date;
                let dateStr;
                try {
                    // Excel speichert Datum als String oder serielle Zahl
                    if (typeof datumCell === 'number') {
                        // Excel serielle Zahl zu Datum (ohne Zeitzone-Probleme)
                        // Excel speichert Datum als Tage seit 1899-12-30
                        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                        const utcDate = new Date(excelEpoch.getTime() + datumCell * 86400000);
                        
                        // Konvertiere zu lokalem Datum ohne Zeitverschiebung
                        const year = utcDate.getUTCFullYear();
                        const month = utcDate.getUTCMonth();
                        const day = utcDate.getUTCDate();
                        date = new Date(year, month, day);
                        
                    } else if (typeof datumCell === 'string') {
                        // String-Datum parsen
                        let cleanDateStr = datumCell.trim();
                        
                        // Entferne Wochentags-Abkürzungen am Anfang (z.B. "Mo 24.11.25" → "24.11.25")
                        // Deutsch: Mo, Di, Mi, Do, Fr, Sa, So
                        // Englisch: Mon, Tue, Wed, Thu, Fri, Sat, Sun
                        cleanDateStr = cleanDateStr.replace(/^(Mo|Di|Mi|Do|Fr|Sa|So|Mon|Tue|Wed|Thu|Fri|Sat|Sun)[,\s]+/i, '');
                        
                        // XLSX.js gibt uns oft ISO-Strings wie "2025-11-24T00:00:00"
                        const isoMatch = cleanDateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
                        if (isoMatch) {
                            const [, year, month, day] = isoMatch;
                            date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                        } else {
                            // Deutsches Format: dd.mm.yy oder dd.mm.yyyy
                            const germanMatch = cleanDateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
                            if (germanMatch) {
                                let [, day, month, year] = germanMatch;
                                // 2-stelliges Jahr zu 4-stellig
                                if (year.length === 2) {
                                    const yearNum = parseInt(year);
                                    year = yearNum < 50 ? '20' + year : '19' + year;
                                }
                                date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                            } else {
                                // Fallback für andere Formate
                                date = new Date(cleanDateStr);
                            }
                        }
                    } else {
                        // Timestamp-Objekt (von pandas/XLSX)
                        date = new Date(datumCell);
                    }
                    
                    if (!date || isNaN(date.getTime())) {
                        errors.push(`Zeile ${rowIndex + 1}: Ungültiges Datum "${datumCell}"`);
                        skippedDays++;
                        continue;
                    }
                    
                    // Formatiere als YYYY-MM-DD für konsistente Darstellung
                    dateStr = formatDate(date);
                    
                } catch (error) {
                    errors.push(`Zeile ${rowIndex + 1}: Fehler beim Parsen von Datum "${datumCell}" - ${error.message}`);
                    skippedDays++;
                    continue;
                }
                
                // Für jeden zugeordneten Techniker den Status setzen (BATCH - ohne Speichern)
                Object.entries(techMapping).forEach(([colIndex, appTech]) => {
                    const colIdx = parseInt(colIndex);
                    
                    const excelCode = row[colIdx] || '';
                    const excelCodeClean = excelCode.toString().trim().toUpperCase();
                    
                    // Code mappen - nur setzen wenn nicht leer
                    if (excelCodeClean && codeMapping.hasOwnProperty(excelCodeClean)) {
                        const appStatus = codeMapping[excelCodeClean];
                        if (appStatus) { // Nur setzen wenn gemappter Status nicht leer ist
                            setScheduleStatusBatch(appTech.id, dateStr, appStatus);
                        }
                    }
                });
                
                importedDays++;
                
                // Progress aktualisieren (mit yield für UI-Responsiveness)
                if (importedDays % 10 === 0) {
                    const progress = Math.min(95, (importedDays / (sheetData.length - 1)) * 100);
                    updateProgress(progress, 100, `Importiere Tag ${importedDays}...`, errors);
                    // Kurze Pause um UI zu aktualisieren
                    await new Promise(resolve => setTimeout(resolve, 0));
                }
            }
            
            console.log(`✅ Import abgeschlossen: ${importedDays} Tage, ${skippedDays} übersprungen`);
            
            // JETZT erst speichern (einmal am Ende)
            updateProgress(98, 100, 'Speichere Daten...', errors);
            await new Promise(resolve => setTimeout(resolve, 10));
            saveToLocalStorage();
            renderScheduleCalendar();
            
            updateProgress(100, 100, 'Import abgeschlossen!', errors);
            
            setTimeout(() => {
                closeProgressModal();
                alert(`✅ Kalender-Import erfolgreich!\n\n📅 ${importedDays} Tage importiert\n👷 ${Object.keys(techMapping).length} Techniker zugeordnet\n⏭️ ${skippedDays} Zeilen übersprungen\n${errors.length > 0 ? '\n⚠️ ' + errors.length + ' Fehler (siehe Konsole)' : ''}`);
                
                if (errors.length > 0) {
                    console.error('Import-Fehler:', errors);
                }
            }, 500);
            
        } catch (error) {
            console.error('Kalender-Import Fehler:', error);
            alert('❌ Fehler beim Lesen der Excel-Datei:\n\n' + error.message);
            closeProgressModal();
        }
    };
    
    reader.readAsArrayBuffer(file);
    
    // File input zurücksetzen
    e.target.value = '';
}

// Techniker Excel importieren
async function importTechnikerExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Frage nur wenn bereits Techniker vorhanden sind
    let replaceExisting = false;
    if (techniker.length > 0) {
        const userChoice = confirm(
            `📊 Techniker-Import: ${file.name}\n\n` +
            `Sie haben bereits ${techniker.length} Techniker gespeichert.\n\n` +
            `Möchten Sie die vorhandenen Daten BEHALTEN und die neuen Daten ergänzen?\n\n` +
            `✅ OK = Ergänzen (alte Daten bleiben erhalten)\n` +
            `❌ Abbrechen = Ersetzen (alte Daten werden gelöscht)`
        );
        
        if (userChoice === null) {
            // Dialog wurde geschlossen - Import abbrechen
            e.target.value = '';
            return;
        }
        
        replaceExisting = !userChoice; // true wenn "Abbrechen" geklickt wurde
        
        if (replaceExisting) {
            // Finale Bestätigung vor dem Löschen
            const finalConfirm = confirm(
                `⚠️ WARNUNG: Alle vorhandenen Techniker löschen?\n\n` +
                `Dies wird ${techniker.length} Techniker unwiderruflich löschen!\n\n` +
                `Sind Sie sicher?`
            );
            
            if (!finalConfirm) {
                e.target.value = '';
                return;
            }
            
            // Alte Daten löschen
            console.log('🗑️ Lösche vorhandene Techniker...');
            techniker = [];
            technikerMarkers.forEach(item => map.removeLayer(item.marker));
            technikerMarkers = [];
            
            // Isochronen auch löschen
            clearIsochrones();
        }
    }
    
    showProgressModal();
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Erstes Sheet lesen
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            console.log('📊 Excel-Daten geladen:', jsonData);
            
            if (jsonData.length === 0) {
                alert('Die Excel-Datei ist leer!');
                closeProgressModal();
                return;
            }
            
            // Spalten erkennen (flexibel)
            const firstRow = jsonData[0];
            let nameCol = null;
            let vornameCol = null;
            let strasseCol = null;
            let plzCol = null;
            let ortCol = null;
            let skillsCol = null;
            let rslCol = null;
            
            // Suche nach Name-Spalte (Nachname)
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'name' || lowerKey === 'nachname') {
                    nameCol = key;
                    break;
                }
            }
            
            // Suche nach Vorname-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'vorname') {
                    vornameCol = key;
                    break;
                }
            }
            
            // Suche nach Straße-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('straße') || lowerKey.includes('strasse') || lowerKey.includes('str')) {
                    strasseCol = key;
                    break;
                }
            }
            
            // Suche nach PLZ-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'plz' || lowerKey === 'postleitzahl') {
                    plzCol = key;
                    break;
                }
            }
            
            // Suche nach Ort-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'ort' || lowerKey === 'stadt' || lowerKey === 'city') {
                    ortCol = key;
                    break;
                }
            }
            
            // Suche nach Skills-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('skill') || lowerKey.includes('fähigkeit') ||
                    lowerKey.includes('kompetenz')) {
                    skillsCol = key;
                    break;
                }
            }
            
            // Suche nach RSL/Teamgebiet-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('rsl') || lowerKey.includes('teamgebiet') || 
                    lowerKey.includes('team') || lowerKey.includes('gebiet')) {
                    rslCol = key;
                    break;
                }
            }
            
            if (!nameCol || !vornameCol || !strasseCol || !plzCol || !ortCol) {
                alert(`Spalten nicht gefunden!\n\nErwartet: Name, Vorname, Straße, PLZ, Ort\nGefunden: ${Object.keys(firstRow).join(', ')}\n\nBitte benennen Sie die Spalten entsprechend.`);
                closeProgressModal();
                return;
            }
            
            console.log(`✅ Spalten erkannt: Name="${nameCol}", Vorname="${vornameCol}", Straße="${strasseCol}", PLZ="${plzCol}", Ort="${ortCol}", Skills="${skillsCol || 'nicht vorhanden'}", RSL="${rslCol || 'nicht vorhanden'}"`);
            
            // Geocoding durchführen
            const errors = [];
            let successCount = 0;
            const startId = techniker.length > 0 ? Math.max(...techniker.map(t => t.id)) + 1 : 1;
            
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const name = row[nameCol];
                const vorname = row[vornameCol];
                const strasse = row[strasseCol];
                const plz = row[plzCol];
                const ort = row[ortCol];
                const skillsInput = skillsCol ? (row[skillsCol] || '') : '';
                const rsl = rslCol ? (row[rslCol] || '').toString().trim() : '';
                
                updateProgress(i + 1, jsonData.length, `Geocode: ${vorname} ${name}...`, errors);
                
                if (!name || !vorname || !strasse || !plz || !ort) {
                    errors.push(`Zeile ${i + 2}: Fehlende Daten`);
                    continue;
                }
                
                // Adresse zusammensetzen
                const fullAddress = `${strasse}, ${plz} ${ort}`;
                
                // Skills verarbeiten (kommagetrennt)
                const skills = skillsInput 
                    ? skillsInput.toString().split(',').map(s => s.trim()).filter(s => s.length > 0)
                    : [];
                
                const fullName = `${vorname} ${name}`;
                console.log(`[${i + 1}/${jsonData.length}] Geocode: ${fullName} - ${fullAddress} (Skills: ${skills.join(', ') || 'keine'}, RSL: ${rsl || 'keine'})`);
                
                const result = await geocodeAddressBatch(fullAddress);
                
                if (result.success) {
                    techniker.push({
                        id: startId + successCount,
                        name: fullName,
                        vorname: vorname,
                        nachname: name,
                        strasse: strasse,
                        plz: plz,
                        ort: ort,
                        lat: result.lat,
                        lng: result.lng,
                        active: true,
                        skills: skills,
                        rsl: rsl,
                        visible: true
                    });
                    successCount++;
                    console.log(`   ✅ Erfolgreich: ${result.lat}, ${result.lng}`);
                } else {
                    errors.push(`${name}: ${result.error}`);
                    console.error(`   ❌ Fehler: ${result.error}`);
                }
            }
            
            saveToLocalStorage();
            updateFilters(); // Filter aktualisieren
            initializeSchedule(); // Dienstplan für neue Techniker initialisieren
            renderScheduleCalendar(); // Kalender aktualisieren
            completeProgress(successCount, errors.length);
            
            if (errors.length > 0) {
                console.error('Import-Fehler:', errors);
            }
            
            // Nach erfolgreichem Import: Anbieten, fehlende Isochronen zu laden
            if (successCount > 0 && apiKey) {
                setTimeout(() => {
                    const loadIsos = confirm(
                        `✅ ${successCount} Techniker importiert!\n\n` +
                        `📡 Möchten Sie jetzt die fehlenden Isochronen laden?\n\n` +
                        `Dies lädt nur Isochronen für Techniker ohne gespeicherte Isochronen.`
                    );
                    
                    if (loadIsos) {
                        loadIsochrones();
                    }
                }, 500); // Kurze Verzögerung für bessere UX
            }
            
        } catch (error) {
            console.error('Excel-Import Fehler:', error);
            alert('Fehler beim Lesen der Excel-Datei: ' + error.message);
            closeProgressModal();
        }
    };
    
    reader.readAsArrayBuffer(file);
    
    // File input zurücksetzen
    e.target.value = '';
}

// Kunden Excel importieren
async function importKundenExcel(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    // Frage nur wenn bereits Kunden vorhanden sind
    let replaceExisting = false;
    if (kunden.length > 0) {
        const userChoice = confirm(
            `📊 Kunden-Import: ${file.name}\n\n` +
            `Sie haben bereits ${kunden.length} Kunden gespeichert.\n\n` +
            `Möchten Sie die vorhandenen Daten BEHALTEN und die neuen Daten ergänzen?\n\n` +
            `✅ OK = Ergänzen (alte Daten bleiben erhalten)\n` +
            `❌ Abbrechen = Ersetzen (alte Daten werden gelöscht)`
        );
        
        if (userChoice === null) {
            // Dialog wurde geschlossen - Import abbrechen
            e.target.value = '';
            return;
        }
        
        replaceExisting = !userChoice; // true wenn "Abbrechen" geklickt wurde
        
        if (replaceExisting) {
            // Finale Bestätigung vor dem Löschen
            const finalConfirm = confirm(
                `⚠️ WARNUNG: Alle vorhandenen Kunden löschen?\n\n` +
                `Dies wird ${kunden.length} Kunden unwiderruflich löschen!\n\n` +
                `Sind Sie sicher?`
            );
            
            if (!finalConfirm) {
                e.target.value = '';
                return;
            }
            
            // Alte Daten löschen
            console.log('🗑️ Lösche vorhandene Kunden...');
            kunden = [];
            kundenMarkers.forEach(item => map.removeLayer(item.marker));
            kundenMarkers = [];
        }
    }
    
    showProgressModal();
    
    const reader = new FileReader();
    reader.onload = async function(event) {
        try {
            const data = new Uint8Array(event.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            // Erstes Sheet lesen
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            console.log('📊 Excel-Daten geladen:', jsonData);
            
            if (jsonData.length === 0) {
                alert('Die Excel-Datei ist leer!');
                closeProgressModal();
                return;
            }
            
            // Spalten erkennen (flexibel)
            const firstRow = jsonData[0];
            let nameCol = null;
            let strasseCol = null;
            let plzCol = null;
            let ortCol = null;
            let instrumentLineCol = null;
            let fsmCol = null;
            
            // Suche nach Name-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'name' || lowerKey.includes('kunde') || lowerKey.includes('firma') || 
                    lowerKey.includes('unternehmen')) {
                    nameCol = key;
                    break;
                }
            }
            
            // Suche nach Straße-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('straße') || lowerKey.includes('strasse') || lowerKey.includes('str')) {
                    strasseCol = key;
                    break;
                }
            }
            
            // Suche nach PLZ-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'plz' || lowerKey === 'postleitzahl') {
                    plzCol = key;
                    break;
                }
            }
            
            // Suche nach Ort-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey === 'ort' || lowerKey === 'stadt' || lowerKey === 'city') {
                    ortCol = key;
                    break;
                }
            }
            
            // Suche nach InstrumentLine-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('instrumentline') || lowerKey.includes('instrument') ||
                    lowerKey.includes('line') || lowerKey.includes('geräte')) {
                    instrumentLineCol = key;
                    break;
                }
            }
            
            // Suche nach Field Service Manager / Teamgebiet-Spalte
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('fieldservicemanager') || lowerKey.includes('field service manager') ||
                    lowerKey.includes('fsm') || lowerKey.includes('manager') || 
                    lowerKey.includes('teamgebiet') || lowerKey.includes('rsl')) {
                    fsmCol = key;
                    break;
                }
            }
            
            // Suche nach Techniker-Spalte (optional)
            let technicianCol = null;
            for (const key of Object.keys(firstRow)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey.includes('primaryengineer') || 
                    lowerKey.includes('primary engineer') || 
                    lowerKey.includes('techniker') || 
                    lowerKey.includes('zuständig') || 
                    lowerKey.includes('assigned') || 
                    lowerKey.includes('engineer') ||
                    lowerKey.includes('tech')) {
                    technicianCol = key;
                    break;
                }
            }
            
            if (!nameCol || !strasseCol || !plzCol || !ortCol) {
                alert(`Spalten nicht gefunden!\n\nErwartet: Name, Straße, PLZ, Ort\nGefunden: ${Object.keys(firstRow).join(', ')}\n\nBitte benennen Sie die Spalten entsprechend.`);
                closeProgressModal();
                return;
            }
            
            console.log(`✅ Spalten erkannt: Name="${nameCol}", Straße="${strasseCol}", PLZ="${plzCol}", Ort="${ortCol}", InstrumentLine="${instrumentLineCol || 'nicht vorhanden'}", FSM="${fsmCol || 'nicht vorhanden'}", Techniker="${technicianCol || 'nicht vorhanden'}"`);
            
            // Zuerst alle Daten aus Excel mit Geocoding laden (temporärer Array)
            const tempCustomers = [];
            const errors = [];
            
            // PARALLEL GEOCODING: Process in small batches to respect API rate limits
            const BATCH_SIZE = 2; // 2 addresses at once (Nominatim strict limit ~1 req/s)
            const BATCH_DELAY = 1500; // 1.5 seconds between batches
            const batches = [];
            
            // Prepare all rows for geocoding
            for (let i = 0; i < jsonData.length; i++) {
                const row = jsonData[i];
                const name = row[nameCol];
                const strasse = row[strasseCol];
                const plz = row[plzCol];
                const ort = row[ortCol];
                const instrumentLine = instrumentLineCol ? (row[instrumentLineCol] || '').trim() : '';
                const fsm = fsmCol ? (row[fsmCol] || '').toString().trim() : '';
                const technicianName = technicianCol ? (row[technicianCol] || '').toString().trim() : '';
                
                if (!name || !strasse || !plz || !ort) {
                    errors.push(`Zeile ${i + 2}: Fehlende Daten`);
                    continue;
                }
                
                batches.push({
                    index: i,
                    name: name.trim(),
                    strasse: strasse,
                    plz: plz,
                    ort: ort,
                    instrumentLine: instrumentLine,
                    fieldServiceManager: fsm,
                    technicianName: technicianName,
                    fullAddress: `${strasse}, ${plz} ${ort}`
                });
            }
            
            console.log(`📦 Verarbeite ${batches.length} Adressen in Batches von ${BATCH_SIZE}...`);
            
            // Process in parallel batches
            for (let batchStart = 0; batchStart < batches.length; batchStart += BATCH_SIZE) {
                const batch = batches.slice(batchStart, batchStart + BATCH_SIZE);
                const batchEnd = Math.min(batchStart + BATCH_SIZE, batches.length);
                
                console.log(`🔄 Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(batches.length / BATCH_SIZE)}: Geocode ${batch.length} Adressen parallel...`);
                
                // Geocode all addresses in this batch simultaneously
                const geocodePromises = batch.map(async (item) => {
                    try {
                        const result = await geocodeAddressBatch(item.fullAddress);
                        return { ...item, geocodeResult: result };
                    } catch (error) {
                        return { 
                            ...item, 
                            geocodeResult: { 
                                success: false, 
                                error: error.message || 'Geocoding-Fehler' 
                            } 
                        };
                    }
                });
                
                // Wait for all geocoding in this batch to complete
                const results = await Promise.all(geocodePromises);
                
                // Process results
                results.forEach((item, idx) => {
                    const absoluteIndex = batchStart + idx;
                    updateProgress(absoluteIndex + 1, batches.length, `Verarbeitet: ${item.name}`, errors);
                    
                    if (item.geocodeResult.success) {
                        tempCustomers.push({
                            name: item.name,
                            strasse: item.strasse,
                            plz: item.plz,
                            ort: item.ort,
                            instrumentLine: item.instrumentLine,
                            fieldServiceManager: item.fieldServiceManager,
                            technicianName: item.technicianName,
                            lat: item.geocodeResult.lat,
                            lng: item.geocodeResult.lng
                        });
                        console.log(`   ✅ [${absoluteIndex + 1}/${batches.length}] ${item.name}: ${item.geocodeResult.lat}, ${item.geocodeResult.lng}`);
                    } else {
                        errors.push(`${item.name}: ${item.geocodeResult.error}`);
                        console.error(`   ❌ [${absoluteIndex + 1}/${batches.length}] ${item.name}: ${item.geocodeResult.error}`);
                    }
                });
                
                // Longer delay between batches to respect API rate limits
                if (batchEnd < batches.length) {
                    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
                }
            }
            
            // Jetzt Kunden nach Name und Standort gruppieren
            console.log('📋 Gruppiere Kunden nach Name und Standort...');
            const customerGroups = new Map();
            
            tempCustomers.forEach(temp => {
                // Schlüssel: Name + gerundete Koordinaten (auf 3 Dezimalstellen)
                const key = `${temp.name}_${temp.lat.toFixed(3)}_${temp.lng.toFixed(3)}`;
                
                if (customerGroups.has(key)) {
                    // Kunde existiert bereits im Import - InstrumentLine HINZUFÜGEN (auch Duplikate)
                    const existing = customerGroups.get(key);
                    if (temp.instrumentLine) {
                        existing.instrumentLines.push(temp.instrumentLine);
                        // Speichere auch den zugehörigen Techniker für diese InstrumentLine
                        if (temp.technicianName) {
                            existing.technicianNames.push(temp.technicianName);
                        }
                    }
                    // FSM übernehmen falls vorhanden und noch nicht gesetzt
                    if (temp.fieldServiceManager && !existing.fieldServiceManager) {
                        existing.fieldServiceManager = temp.fieldServiceManager;
                    }
                } else {
                    // Neuer Kunde
                    customerGroups.set(key, {
                        name: temp.name,
                        strasse: temp.strasse,
                        plz: temp.plz,
                        ort: temp.ort,
                        lat: temp.lat,
                        lng: temp.lng,
                        instrumentLines: temp.instrumentLine ? [temp.instrumentLine] : [],
                        fieldServiceManager: temp.fieldServiceManager,
                        technicianNames: temp.technicianName ? [temp.technicianName] : []
                    });
                }
            });
            
            // Gruppierte Kunden zur kunden-Liste hinzufügen
            let successCount = 0;
            const startId = kunden.length > 0 ? Math.max(...kunden.map(k => k.id)) + 1 : 1000;
            
            // Track welche Skills welchem Techniker zugewiesen werden
            const technicianSkills = new Map(); // { techId: Set of device names }
            
            customerGroups.forEach((group, key) => {
                // Prüfen ob dieser Kunde bereits existiert
                const existingKunde = kunden.find(k => 
                    k.name.toLowerCase() === group.name.toLowerCase() && 
                    Math.abs(k.lat - group.lat) < 0.001 && 
                    Math.abs(k.lng - group.lng) < 0.001
                );
                
                if (existingKunde) {
                    // Kunde existiert bereits - InstrumentLines AUFADDIEREN (nicht prüfen ob schon vorhanden)
                    if (!Array.isArray(existingKunde.instrumentLines)) {
                        existingKunde.instrumentLines = existingKunde.instrumentLineName ? [existingKunde.instrumentLineName] : [];
                    }
                    
                    // Assignment System: Initialisiere deviceAssignments für Backward-Kompatibilität
                    if (!existingKunde.deviceAssignments) {
                        existingKunde.deviceAssignments = {};
                    }
                    
                    let addedDevices = 0;
                    let assignedDevices = 0;
                    
                    group.instrumentLines.forEach((line, idx) => {
                        if (line) {
                            // Gerät hinzufügen
                            existingKunde.instrumentLines.push(line);
                            addedDevices++;
                            
                            // Auto-Zuweisung wenn Techniker angegeben
                            const technicianName = group.technicianNames[idx];
                            if (technicianName) {
                                // Finde Techniker anhand des Namens - flexible Suche
                                const searchName = technicianName.toLowerCase().trim();
                                
                                // Versuche verschiedene Matching-Strategien
                                let tech = null;
                                
                                // 1. Exakte Übereinstimmung
                                tech = techniker.find(t => 
                                    t.name.toLowerCase() === searchName
                                );
                                
                                // 2. Name enthält den Suchbegriff oder umgekehrt
                                if (!tech) {
                                    tech = techniker.find(t => {
                                        const techName = t.name.toLowerCase();
                                        return techName.includes(searchName) || searchName.includes(techName);
                                    });
                                }
                                
                                // 3. Nachname-Match (falls Nachname im Suchbegriff enthalten ist)
                                if (!tech && searchName.includes(' ')) {
                                    const nameParts = searchName.split(' ');
                                    const lastName = nameParts[nameParts.length - 1]; // Letzter Teil = Nachname
                                    tech = techniker.find(t => 
                                        t.name.toLowerCase().includes(lastName)
                                    );
                                }
                                
                                if (tech) {
                                    // Berechne Device-Index für dieses Gerät
                                    const deviceCount = existingKunde.instrumentLines.filter((d, i) => 
                                        i < existingKunde.instrumentLines.length && d.trim() === line.trim()
                                    ).length;
                                    const deviceIndex = deviceCount - 1; // -1 weil wir gerade hinzugefügt haben
                                    const deviceKey = `${line.trim()}_${deviceIndex}`;
                                    
                                    // Zuweisung vornehmen
                                    existingKunde.deviceAssignments[deviceKey] = tech.id;
                                    assignedDevices++;
                                    console.log(`      → Gerät "${deviceKey}" zu Techniker "${tech.name}" zugewiesen`);
                                    
                                    // Track Skill für diesen Techniker
                                    if (!technicianSkills.has(tech.id)) {
                                        technicianSkills.set(tech.id, new Set());
                                    }
                                    technicianSkills.get(tech.id).add(line.trim());
                                } else {
                                    console.warn(`      ⚠️ Techniker "${technicianName}" nicht gefunden für Gerät "${line}"`);
                                }
                            }
                        }
                    });
                    
                    if (addedDevices > 0) {
                        console.log(`   ✓ ${addedDevices} Gerät(e) zu existierendem Kunden "${group.name}" hinzugefügt (${assignedDevices} zugewiesen, Total: ${existingKunde.instrumentLines.length})`);
                    }
                    
                    // FSM aktualisieren falls vorhanden
                    if (group.fieldServiceManager) {
                        existingKunde.fieldServiceManager = group.fieldServiceManager;
                    }
                } else {
                    // Neuer Kunde hinzufügen
                    const newCustomer = {
                        id: startId + successCount,
                        name: group.name,
                        strasse: group.strasse,
                        plz: group.plz,
                        ort: group.ort,
                        instrumentLines: group.instrumentLines,
                        fieldServiceManager: group.fieldServiceManager,
                        lat: group.lat,
                        lng: group.lng,
                        covered: false,
                        visible: true,
                        deviceAssignments: {} // Assignment system
                    };
                    
                    // Auto-Zuweisung der Geräte wenn Techniker angegeben
                    let assignedDevices = 0;
                    const deviceIndices = {}; // Track indices per device type
                    
                    group.instrumentLines.forEach((line, idx) => {
                        if (line) {
                            const trimmedDevice = line.trim();
                            
                            // Track index for this device type
                            if (!deviceIndices[trimmedDevice]) {
                                deviceIndices[trimmedDevice] = 0;
                            }
                            const deviceIndex = deviceIndices[trimmedDevice];
                            deviceIndices[trimmedDevice]++;
                            
                            const technicianName = group.technicianNames[idx];
                            if (technicianName) {
                                // Finde Techniker anhand des Namens - flexible Suche
                                const searchName = technicianName.toLowerCase().trim();
                                
                                // Versuche verschiedene Matching-Strategien
                                let tech = null;
                                
                                // 1. Exakte Übereinstimmung
                                tech = techniker.find(t => 
                                    t.name.toLowerCase() === searchName
                                );
                                
                                // 2. Name enthält den Suchbegriff oder umgekehrt
                                if (!tech) {
                                    tech = techniker.find(t => {
                                        const techName = t.name.toLowerCase();
                                        return techName.includes(searchName) || searchName.includes(techName);
                                    });
                                }
                                
                                // 3. Nachname-Match (falls Nachname im Suchbegriff enthalten ist)
                                if (!tech && searchName.includes(' ')) {
                                    const nameParts = searchName.split(' ');
                                    const lastName = nameParts[nameParts.length - 1]; // Letzter Teil = Nachname
                                    tech = techniker.find(t => 
                                        t.name.toLowerCase().includes(lastName)
                                    );
                                }
                                
                                if (tech) {
                                    const deviceKey = `${trimmedDevice}_${deviceIndex}`;
                                    newCustomer.deviceAssignments[deviceKey] = tech.id;
                                    assignedDevices++;
                                    console.log(`      → Gerät "${deviceKey}" zu Techniker "${tech.name}" zugewiesen`);
                                    
                                    // Track Skill für diesen Techniker
                                    if (!technicianSkills.has(tech.id)) {
                                        technicianSkills.set(tech.id, new Set());
                                    }
                                    technicianSkills.get(tech.id).add(trimmedDevice);
                                } else {
                                    console.warn(`      ⚠️ Techniker "${technicianName}" nicht gefunden für Gerät "${line}"`);
                                }
                            }
                        }
                    });
                    
                    kunden.push(newCustomer);
                    successCount++;
                    const deviceCount = group.instrumentLines.length;
                    console.log(`   ✓ Kunde "${group.name}" mit ${deviceCount} Gerät(en) hinzugefügt (${assignedDevices} zugewiesen, FSM: ${group.fieldServiceManager || 'keine'})`);
                }
            });
            
            console.log(`✅ Import abgeschlossen: ${successCount} neue Kunden, ${customerGroups.size - successCount} zu existierenden hinzugefügt`);
            
            // Skills zu Technikern hinzufügen basierend auf Zuweisungen
            let skillsAddedCount = 0;
            technicianSkills.forEach((deviceSet, techId) => {
                const tech = techniker.find(t => t.id === techId);
                if (tech) {
                    // Initialisiere skills array falls nicht vorhanden
                    if (!tech.skills) {
                        tech.skills = [];
                    }
                    
                    // Füge neue Skills hinzu (keine Duplikate)
                    deviceSet.forEach(deviceName => {
                        const skillExists = tech.skills.some(skill => 
                            skill.toLowerCase() === deviceName.toLowerCase()
                        );
                        
                        if (!skillExists) {
                            tech.skills.push(deviceName);
                            skillsAddedCount++;
                            console.log(`   🎯 Skill "${deviceName}" zu Techniker "${tech.name}" hinzugefügt`);
                        }
                    });
                }
            });
            
            if (skillsAddedCount > 0) {
                console.log(`✅ ${skillsAddedCount} Skills automatisch hinzugefügt`);
                // Techniker-Liste aktualisieren um neue Skills anzuzeigen
                updateTechnikerList();
            }
            
            saveToLocalStorage();
            updateFilters(); // Filter aktualisieren
            updateDeviceWeightsUI(); // Device weights aktualisieren
            completeProgress(successCount, errors.length);
            
            if (errors.length > 0) {
                console.error('Import-Fehler:', errors);
            }
            
        } catch (error) {
            console.error('Excel-Import Fehler:', error);
            alert('Fehler beim Lesen der Excel-Datei: ' + error.message);
            closeProgressModal();
        }
    };
    
    reader.readAsArrayBuffer(file);
    
    // File input zurücksetzen
    e.target.value = '';
}

// ===== DIENSTPLAN FUNKTIONEN =====

// Dienstplan initialisieren für alle Techniker
function initializeSchedule() {
    techniker.forEach(tech => {
        if (!schedule[tech.id]) {
            schedule[tech.id] = {};
            // Neue Techniker sind standardmäßig an allen Tagen aktiv
            // Aber wir initialisieren nur bei Bedarf (lazy initialization)
        }
    });
}

// Status für einen bestimmten Tag abrufen
function getScheduleStatus(techId, dateStr) {
    if (!schedule[techId]) {
        schedule[techId] = {};
    }
    // Kein Default - gibt undefined/null zurück wenn kein Status gesetzt
    return schedule[techId][dateStr] || '';
}

// Status für einen Tag setzen (mit optionalem Speichern)
function setScheduleStatus(techId, dateStr, status, skipSave = false) {
    if (!schedule[techId]) {
        schedule[techId] = {};
    }
    
    // Leerer Status = Status löschen
    if (status === '' || status === null || status === undefined) {
        delete schedule[techId][dateStr];
        if (!skipSave) {
            saveToLocalStorage();
            // Wenn aktueller Tag geändert wurde, Analyse und Karte aktualisieren
            updateAnalysisIfCurrentDay(dateStr);
        }
        return true;
    }
    
    // Validiere Status
    const validStatuses = ['ZR', 'X', 'I', 'W', 'K', 'U'];
    if (validStatuses.includes(status.toUpperCase())) {
        schedule[techId][dateStr] = status.toUpperCase();
        if (!skipSave) {
            saveToLocalStorage();
            // Wenn aktueller Tag geändert wurde, Analyse und Karte aktualisieren
            updateAnalysisIfCurrentDay(dateStr);
        }
        return true;
    }
    return false;
}

// Hilfsfunktion: Aktualisiert Analyse wenn der geänderte Tag der aktuell ausgewählte ist
function updateAnalysisIfCurrentDay(changedDateStr) {
    // Im Strategiemodus keine Aktualisierung bei Kalenderänderungen
    if (appMode === 'strategy') return;
    
    if (!selectedDate) return;
    
    const currentDateStr = formatDate(selectedDate);
    if (changedDateStr === currentDateStr) {
        // Karte aktualisieren (zeigt nur ZR-Techniker)
        updateMapForSelectedDate();
        
        // Wenn Analyse-Panel offen ist, aktualisieren
        const analysisPanel = document.getElementById('analysisPanel');
        if (analysisPanel && analysisPanel.classList.contains('active')) {
            calculateDayAnalysis();
        }
    }
}

// Batch-Version: Setzt Status OHNE zu speichern (für Imports)
function setScheduleStatusBatch(techId, dateStr, status) {
    return setScheduleStatus(techId, dateStr, status, true);
}

// Bereinige alte Default-ZR von Wochenenden (Hilfsfunktion für Migration)
function cleanupWeekendDefaults() {
    let cleanedCount = 0;
    
    // Für jeden Techniker
    Object.keys(schedule).forEach(techId => {
        const techSchedule = schedule[techId];
        
        // Für jeden gesetzten Tag
        Object.keys(techSchedule).forEach(dateStr => {
            // Parse das Datum
            const [year, month, day] = dateStr.split('-').map(Number);
            const date = new Date(year, month - 1, day);
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            
            // Wenn es ein Wochenende mit ZR ist, lösche es
            // (Diese wurden wahrscheinlich automatisch gesetzt)
            if (isWeekend && techSchedule[dateStr] === 'ZR') {
                delete techSchedule[dateStr];
                cleanedCount++;
            }
        });
    });
    
    if (cleanedCount > 0) {
        saveToLocalStorage();
        renderScheduleCalendar();
        alert(`✅ ${cleanedCount} Wochenend-Einträge bereinigt.\n\nDie Wochenenden sind jetzt leer und werden ausgegraut angezeigt.`);
    } else {
        alert('ℹ️ Keine Wochenend-Einträge zum Bereinigen gefunden.');
    }
}

// Zentrale Funktion für Schedule-Cell Clicks (installationsplanung oder normale Eingabe)
function handleScheduleCellClick(techId, dateStr, cellElement) {
    // Prüfe ob Installation Planning Modus aktiv ist
    if (installationPlanningMode) {
        // Setze den geklickten Techniker als Projektleiter
        selectedProjectLeader = techId;
        
        // Parse dateStr zurück zu Date
        const parts = dateStr.split('-');
        const startDate = new Date(parts[0], parts[1] - 1, parts[2]);
        
        // Installation eintragen
        scheduleInstallation(startDate);
    } else if (installationAnalysisMode) {
        // Im Analyse-Modus sollte auf die Header geklickt werden, nicht auf Zellen
        alert('⚠️ Bitte klicken Sie auf die Tag-Überschriften (oben), nicht auf die Techniker-Zellen!');
    } else {
        // Normaler Status-Input
        openStatusInput(techId, dateStr, cellElement);
    }
}


// Status durch Tastatureingabe ändern
function openStatusInput(techId, dateStr, cellElement) {
    const currentStatus = getScheduleStatus(techId, dateStr);
    
    // Input-Feld erstellen
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentStatus;
    input.maxLength = 2;
    input.style.cssText = `
        width: 100%;
        height: 100%;
        border: 2px solid #667eea;
        text-align: center;
        font-weight: bold;
        font-size: 11px;
        text-transform: uppercase;
        padding: 0;
        margin: 0;
    `;
    
    // Zelle leeren und Input einfügen
    cellElement.innerHTML = '';
    cellElement.appendChild(input);
    input.focus();
    input.select();
    
    // Bei Enter oder Blur: Wert speichern
    const saveValue = () => {
        const newStatus = input.value.trim().toUpperCase();
        
        if (newStatus === '' || setScheduleStatus(techId, dateStr, newStatus)) {
            renderScheduleCalendar();
            
            // Wenn ein Datum ausgewählt ist und es das gleiche ist, Karte aktualisieren
            if (selectedDate && formatDate(selectedDate) === dateStr) {
                updateMapForSelectedDate();
            } else {
                // Auch ohne selectedDate Marker und Isochronen aktualisieren wenn heute geändert wurde
                const today = formatDate(new Date());
                if (dateStr === today) {
                    // Isochronen-Sichtbarkeit für diesen Techniker aktualisieren
                    const tech = techniker.find(t => t.id === techId);
                    if (tech) {
                        const isoLayer = isochroneLayers.find(layer => layer.techId === techId);
                        if (isoLayer) {
                            const shouldShow = shouldShowIsochrone(tech);
                            
                            if (shouldShow && !map.hasLayer(isoLayer.layer)) {
                                map.addLayer(isoLayer.layer);
                            } else if (!shouldShow && map.hasLayer(isoLayer.layer)) {
                                map.removeLayer(isoLayer.layer);
                            }
                        }
                    }
                    
                    // Marker und Coverage aktualisieren
                    updateAllMarkers();
                    if (isochroneGeoJSON.length > 0) {
                        checkCustomerCoverage();
                        updateStatistics();
                    }
                }
            }
        } else {
            alert(`Ungültiger Status: "${newStatus}"\n\nErlaubt sind: ZR, X, I, W, K, U`);
            renderScheduleCalendar();
        }
    };
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Verhindert Form-Submit
            saveValue();
            
            // Nach dem Speichern: Zur nächsten Zeile (nächster Techniker) springen
            setTimeout(() => {
                const currentTechIndex = techniker.findIndex(t => t.id === techId);
                if (currentTechIndex !== -1 && currentTechIndex < techniker.length - 1) {
                    // Nächster Techniker existiert
                    const nextTech = techniker[currentTechIndex + 1];
                    
                    // Finde die Zelle für den nächsten Techniker am gleichen Tag
                    // Die Zelle hat onclick="openStatusInput(nextTech.id, 'dateStr', this)"
                    const calendarTable = document.querySelector('.schedule-table');
                    if (calendarTable) {
                        // Finde alle schedule-cell divs
                        const cells = calendarTable.querySelectorAll('.schedule-cell');
                        cells.forEach(cell => {
                            const onclickAttr = cell.getAttribute('onclick');
                            if (onclickAttr && onclickAttr.includes(`openStatusInput(${nextTech.id}, '${dateStr}'`)) {
                                // Gefunden! Öffne das Eingabefeld
                                openStatusInput(nextTech.id, dateStr, cell);
                            }
                        });
                    }
                }
            }, 100); // Kurze Verzögerung damit saveValue abgeschlossen ist
        } else if (e.key === 'Escape') {
            renderScheduleCalendar();
        }
    });
    
    input.addEventListener('blur', saveValue);
}

// Kalender-Ansicht wechseln
function setCalendarView(view) {
    calendarView = view;
    document.querySelectorAll('.btn-view').forEach(btn => btn.classList.remove('active'));
    document.getElementById('view' + (view === 'month' ? 'Month' : 'Week')).classList.add('active');
    renderScheduleCalendar();
}

// Monat wechseln
function changeMonth(offset) {
    if (calendarView === 'week') {
        // In Wochenansicht: Wochen verschieben (7 Tage)
        currentCalendarMonth.setDate(currentCalendarMonth.getDate() + (offset * 7));
    } else {
        // In Monatsansicht: Monate verschieben
        currentCalendarMonth.setMonth(currentCalendarMonth.getMonth() + offset);
    }
    updateMonthLabel();
    renderScheduleCalendar();
}

// Zu heute springen
function goToToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Kalender-Monat auf heute setzen
    currentCalendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Ausgewähltes Datum auf heute setzen
    selectedDate = today;
    
    updateMonthLabel();
    renderScheduleCalendar();
    updateMapForSelectedDate(); // Karte für heute aktualisieren
    
    // Wenn Analyse-Panel offen ist, automatisch aktualisieren
    const analysisPanel = document.getElementById('analysisPanel');
    if (analysisPanel && analysisPanel.classList.contains('active')) {
        calculateDayAnalysis();
    }
}

// Monatslabel aktualisieren
function updateMonthLabel() {
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const label = `${months[currentCalendarMonth.getMonth()]} ${currentCalendarMonth.getFullYear()}`;
    document.getElementById('currentMonthLabel').textContent = label;
}

// Kalender rendern
function renderScheduleCalendar() {
    if (techniker.length === 0) {
        document.getElementById('scheduleCalendar').innerHTML = 
            '<div style="padding: 20px; text-align: center; color: #6c757d;">Keine Techniker vorhanden</div>';
        return;
    }

    if (calendarView === 'month') {
        renderMonthView();
    } else {
        renderWeekView();
    }
    
    // Wenn Vollbild-Modal offen ist, auch dort aktualisieren
    if (document.getElementById('fullscreenCalendarModal').style.display === 'block') {
        renderFullscreenCalendar();
    }
}

// Monatsansicht rendern
function renderMonthView() {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let html = '<table class="schedule-table"><thead><tr>';
    html += '<th class="tech-name">Techniker</th>';
    
    // Tage als Spalten
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()];
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = date.getTime() === today.getTime();
        const dateStr = formatDate(date);
        const isSelected = selectedDate && formatDate(selectedDate) === dateStr;
        
        html += `<th class="day-header ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''}"
                     onclick="selectDateAndAnalyze('${dateStr}')" style="cursor: pointer;">`;
        html += `<span class="day-name">${dayName}</span>`;
        html += `<span class="day-number">${day}</span>`;
        html += '</th>';
    }
    
    html += '</tr></thead><tbody>';
    
    // Techniker als Zeilen (nur sichtbare nach RSL-Filter)
    const visibleTechniker = techniker.filter(tech => tech.visible !== false);
    
    if (visibleTechniker.length === 0) {
        html += '<tr><td colspan="' + (daysInMonth + 1) + '" style="text-align: center; padding: 20px; color: #6c757d;">Keine Techniker entsprechen den aktuellen Filtern</td></tr>';
    } else {
        visibleTechniker.forEach(tech => {
            html += '<tr>';
            html += `<td class="tech-name">${tech.name}${tech.rsl ? ' <small style="color: #6c757d;">(' + tech.rsl + ')</small>' : ''}</td>`;
        
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            const dateStr = formatDate(date);
            const status = getScheduleStatus(tech.id, dateStr);
            const isPast = date < today;
            const isToday = date.getTime() === today.getTime();
            const isSelected = selectedDate && formatDate(selectedDate) === dateStr;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            
            // Wochenende ohne Status = ausgegraut
            const isEmptyWeekend = isWeekend && !status;
            
            const bgColor = isEmptyWeekend ? '#e9ecef' : (STATUS_TYPES[status]?.color || '#f8f9fa');
            const textColor = isEmptyWeekend ? '#adb5bd' : (STATUS_TYPES[status]?.textColor || '#000');
            
            html += '<td>';
            html += `<div class="schedule-cell ${isPast ? 'disabled' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isEmptyWeekend ? 'empty-weekend' : ''}"
                          style="background-color: ${bgColor}; color: ${textColor}; ${isPast ? 'opacity: 0.4;' : ''}"
                          onclick="${isPast ? '' : `openStatusInput(${tech.id}, '${dateStr}', this)`}">`;
            html += status || (isEmptyWeekend ? '-' : '');
            html += '</div>';
            html += '</td>';
        }
        
        html += '</tr>';
    });
    }
    
    html += '</tbody></table>';
    document.getElementById('scheduleCalendar').innerHTML = html;
}

// Wochenansicht rendern
function renderWeekView() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Aktuelle Woche finden (Montag bis Sonntag)
    const currentDate = new Date(currentCalendarMonth);
    const dayOfWeek = currentDate.getDay();
    const diff = currentDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1); // Montag
    const monday = new Date(currentDate.setDate(diff));
    
    let html = '<table class="schedule-table"><thead><tr>';
    html += '<th class="tech-name">Techniker</th>';
    
    // 7 Tage (Mo-So)
    const days = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        days.push(date);
        
        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()];
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = date.getTime() === today.getTime();
        const dateStr = formatDate(date);
        const isSelected = selectedDate && formatDate(selectedDate) === dateStr;
        
        html += `<th class="day-header ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''}"
                     onclick="selectDateAndAnalyze('${dateStr}')" style="cursor: pointer;">`;
        html += `<span class="day-name">${dayName}</span>`;
        html += `<span class="day-number">${date.getDate()}.${date.getMonth() + 1}</span>`;
        html += '</th>';
    }
    
    html += '</tr></thead><tbody>';
    
    // Techniker als Zeilen
    techniker.forEach(tech => {
        html += '<tr>';
        html += `<td class="tech-name">${tech.name}</td>`;
        
        days.forEach(date => {
            const dateStr = formatDate(date);
            const status = getScheduleStatus(tech.id, dateStr);
            const isPast = date < today;
            const isToday = date.getTime() === today.getTime();
            const isSelected = selectedDate && formatDate(selectedDate) === dateStr;
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            
            // Wochenende ohne Status = ausgegraut
            const isEmptyWeekend = isWeekend && !status;
            
            const bgColor = isEmptyWeekend ? '#e9ecef' : (STATUS_TYPES[status]?.color || '#f8f9fa');
            const textColor = isEmptyWeekend ? '#adb5bd' : (STATUS_TYPES[status]?.textColor || '#000');
            
            html += '<td>';
            html += `<div class="schedule-cell ${isPast ? 'disabled' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected' : ''} ${isEmptyWeekend ? 'empty-weekend' : ''}"
                          style="background-color: ${bgColor}; color: ${textColor}; ${isPast ? 'opacity: 0.4;' : ''}"
                          onclick="${isPast ? '' : `openStatusInput(${tech.id}, '${dateStr}', this)`}">`;
            html += status || (isEmptyWeekend ? '-' : '');
            html += '</div>';
            html += '</td>';
        });
        
        html += '</tr>';
    });
    
    html += '</tbody></table>';
    document.getElementById('scheduleCalendar').innerHTML = html;
}

// Tag auswählen und automatisch Analyse durchführen
function selectDateAndAnalyze(dateStr) {
    // Prüfe ob Installation Analysis Modus aktiv ist
    if (installationAnalysisMode) {
        const clickedDate = new Date(dateStr);
        
        if (!analysisStartDate) {
            // Erster Klick: Starttag setzen
            analysisStartDate = clickedDate;
            console.log(`📅 Analyse-Starttag: ${dateStr}`);
            
            // Update Anweisungen
            const instructionsDiv = document.getElementById('analysisInstructions');
            if (instructionsDiv) {
                instructionsDiv.innerHTML = `
                    <strong style="font-size: 18px;">📊 Installationsanalyse</strong><br><br>
                    <span style="font-size: 14px;">Starttag: <strong>${formatDateGerman(analysisStartDate)}</strong></span><br><br>
                    <span style="font-size: 14px;">Bitte wählen Sie den <strong>Endtag</strong> im Kalender</span><br><br>
                    <button onclick="cancelInstallationAnalysis()" style="
                        background: white;
                        color: #667eea;
                        border: none;
                        padding: 8px 20px;
                        border-radius: 6px;
                        cursor: pointer;
                        font-weight: 600;
                        font-size: 13px;
                    ">Abbrechen</button>
                `;
            }
            
            // Kalender neu rendern um Auswahl zu zeigen
            renderFullscreenCalendar();
            
        } else if (!analysisEndDate) {
            // Zweiter Klick: Endtag setzen
            if (clickedDate < analysisStartDate) {
                alert('❌ Endtag muss nach dem Starttag liegen!');
                return;
            }
            
            analysisEndDate = clickedDate;
            console.log(`📅 Analyse-Endtag: ${dateStr}`);
            
            // Entferne Anweisungen
            const instructionsDiv = document.getElementById('analysisInstructions');
            if (instructionsDiv) {
                instructionsDiv.remove();
            }
            
            // Berechne alle Arbeitstage im Zeitraum
            const days = [];
            let currentDate = new Date(analysisStartDate);
            
            while (currentDate <= analysisEndDate) {
                const dayOfWeek = currentDate.getDay();
                
                // Nur Mo-Fr (1-5), keine Feiertage
                if (dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday(currentDate)) {
                    days.push(new Date(currentDate));
                }
                
                // Nächster Tag
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            if (days.length === 0) {
                alert('⚠️ Keine Arbeitstage im gewählten Zeitraum!');
                installationAnalysisMode = false;
                analysisStartDate = null;
                analysisEndDate = null;
                renderFullscreenCalendar();
                return;
            }
            
            // Führe Analyse durch
            performInstallationAnalysis(days, analysisProjectLeader);
            
            // Reset Analyse-Modus
            installationAnalysisMode = false;
            analysisStartDate = null;
            analysisEndDate = null;
            renderFullscreenCalendar();
        }
        
        return;
    }
    
    // Normaler Modus: Datum auswählen und Karte aktualisieren
    selectedDate = new Date(dateStr);
    console.log(`📅 Tag ausgewählt: ${dateStr}`);
    
    renderScheduleCalendar();
    updateMapForSelectedDate();
    
    // Wenn Analyse-Panel offen ist, automatisch aktualisieren
    const analysisPanel = document.getElementById('analysisPanel');
    if (analysisPanel && analysisPanel.classList.contains('active')) {
        calculateDayAnalysis();
    }
}

// Karte für ausgewähltes Datum aktualisieren
function updateMapForSelectedDate() {
    if (!selectedDate) {
        // Kein Datum ausgewählt - alle aktiven Techniker anzeigen (normaler Modus)
        techniker.forEach(tech => {
            tech.visible = tech.visible !== false; // Respektiere Filter
        });
        updateAllMarkers();
        updateUI();
        return;
    }
    
    const dateStr = formatDate(selectedDate);
    console.log(`🗓️ Aktualisiere Karte für ${dateStr}`);
    
    // Nur Techniker anzeigen die an diesem Tag Status "ZR" (Bereitschaft) haben
    let activeCount = 0;
    techniker.forEach(tech => {
        const status = getScheduleStatus(tech.id, dateStr);
        const isActiveOnDate = status === 'ZR'; // Nur ZR = aktiv
        
        if (isActiveOnDate) {
            activeCount++;
        }
        
        // tech.active NICHT überschreiben - das ist nur für manuelle Kontrolle
        // Die Status-Codes werden von getTechnikerIcon direkt aus dem Schedule gelesen
        
        // Marker visibility bleibt für Filter-Logik
        tech.visible = tech.visible !== false;
    });
    
    console.log(`   ✅ ${activeCount} Techniker mit Status ZR (Bereitschaft)`);
    
    // Isochronen entsprechend ein/ausblenden
    isochroneLayers.forEach(isoLayer => {
        const tech = techniker.find(t => t.id === isoLayer.techId);
        if (tech) {
            // Berücksichtigt: Status, Filter (visible) und manuelles active
            const shouldShow = tech.visible !== false && shouldShowIsochrone(tech);
            
            if (shouldShow && !map.hasLayer(isoLayer.layer)) {
                // Einblenden
                map.addLayer(isoLayer.layer);
            } else if (!shouldShow && map.hasLayer(isoLayer.layer)) {
                // Ausblenden
                map.removeLayer(isoLayer.layer);
            }
        }
    });
    
    // Coverage-Analyse für diesen Tag durchführen
    if (isochroneGeoJSON.length > 0) {
        console.log('🔄 Führe Coverage-Analyse für gewähltes Datum durch...');
        checkCustomerCoverage();
    }
    
    updateAllMarkers();
    updateUI();
    
    // Analyse-Panel aktualisieren falls geöffnet
    const infoPanel = document.getElementById('infoPanel');
    if (infoPanel && infoPanel.classList.contains('open')) {
        updateDayAnalysis();
    }
}

// Vollbild-Kalender öffnen
function openFullscreenCalendar() {
    document.getElementById('fullscreenCalendarModal').style.display = 'block';
    
    // Installation Planning UI nur im Calendar-Modus anzeigen
    const planningSection = document.getElementById('installationPlanningSection');
    if (appMode === 'calendar') {
        planningSection.style.display = 'block';
    } else {
        planningSection.style.display = 'none';
    }
    
    // Planungsmodus zurücksetzen
    resetInstallationPlanning();
    
    updateMonthLabel();
    renderFullscreenCalendar();
}

// Vollbild-Kalender schließen
function closeFullscreenCalendar() {
    document.getElementById('fullscreenCalendarModal').style.display = 'none';
    renderScheduleCalendar(); // Normal-Kalender aktualisieren
}

// Vollbild-Kalender rendern
function renderFullscreenCalendar() {
    const monthLabel = document.getElementById('fullscreenMonthLabel');
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                    'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    monthLabel.textContent = `${months[currentCalendarMonth.getMonth()]} ${currentCalendarMonth.getFullYear()}`;
    
    // View-Buttons aktualisieren
    document.getElementById('fullscreenViewMonth').classList.toggle('active', calendarView === 'month');
    document.getElementById('fullscreenViewWeek').classList.toggle('active', calendarView === 'week');
    
    // Kalender-Inhalt rendern
    if (calendarView === 'month') {
        renderFullscreenMonth();
    } else {
        renderFullscreenWeek();
    }
}

// Vollbild-Monat rendern
function renderFullscreenMonth() {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let html = '<table class="schedule-table"><thead><tr>';
    html += '<th class="tech-name">Techniker</th>';
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()];
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = date.getTime() === today.getTime();
        const dateStr = formatDate(date);
        const isSelected = selectedDate && formatDate(selectedDate) === dateStr;
        
        // Check if this is the analysis start or end date
        const isAnalysisStart = analysisStartDate && formatDate(analysisStartDate) === dateStr;
        const isAnalysisEnd = analysisEndDate && formatDate(analysisEndDate) === dateStr;
        const isInAnalysisRange = analysisStartDate && analysisEndDate && 
                                   date >= analysisStartDate && date <= analysisEndDate;
        
        let additionalStyle = '';
        let additionalClass = '';
        
        if (installationAnalysisMode) {
            if (isAnalysisStart) {
                additionalStyle = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-weight: bold;';
                additionalClass = 'analysis-selected';
            } else if (isAnalysisEnd) {
                additionalStyle = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-weight: bold;';
                additionalClass = 'analysis-selected';
            } else if (isInAnalysisRange) {
                additionalStyle = 'background: rgba(102, 126, 234, 0.2);';
                additionalClass = 'analysis-range';
            }
        }
        
        html += `<th class="day-header ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''} ${additionalClass}"
                     onclick="selectDateAndAnalyze('${dateStr}')" style="cursor: pointer; ${additionalStyle}">`;
        html += `<span class="day-name">${dayName}</span>`;
        html += `<span class="day-number">${day}</span>`;
        html += '</th>';
    }
    
    html += '</tr></thead><tbody>';
    
    // Nur sichtbare Techniker anzeigen (nach RSL/Team-Filter)
    const visibleTechniker = techniker.filter(tech => tech.visible !== false);
    
    if (visibleTechniker.length === 0) {
        html += '<tr><td colspan="' + (daysInMonth + 1) + '" style="text-align: center; padding: 20px; color: #6c757d;">Keine Techniker entsprechen den aktuellen Filtern</td></tr>';
    } else {
        visibleTechniker.forEach(tech => {
            html += '<tr>';
            html += `<td class="tech-name">${tech.name}${tech.rsl ? ' <small style="color: #6c757d;">(' + tech.rsl + ')</small>' : ''}</td>`;
        
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dateStr = formatDate(date);
                const status = getScheduleStatus(tech.id, dateStr);
                const isPast = date < today;
            
                const bgColor = STATUS_TYPES[status]?.color || '#f8f9fa';
                const textColor = STATUS_TYPES[status]?.textColor || '#000';
            
                html += '<td>';
                html += `<div class="schedule-cell ${isPast ? 'disabled' : ''}"
                          style="background-color: ${bgColor}; color: ${textColor}; ${isPast ? 'opacity: 0.4;' : ''} font-weight: bold;"
                          onclick="${isPast ? '' : `handleScheduleCellClick(${tech.id}, '${dateStr}', this)`}">`;
                html += status;
                html += '</div>';
                html += '</td>';
            }
        
            html += '</tr>';
        });
    }
    
    html += '</tbody></table>';
    document.getElementById('fullscreenScheduleCalendar').innerHTML = html;
}

// Vollbild-Woche rendern
function renderFullscreenWeek() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const currentDate = new Date(currentCalendarMonth);
    const dayOfWeek = currentDate.getDay();
    const diff = currentDate.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    const monday = new Date(currentDate.setDate(diff));
    
    let html = '<table class="schedule-table"><thead><tr>';
    html += '<th class="tech-name">Techniker</th>';
    
    const days = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + i);
        days.push(date);
        
        const dayName = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][date.getDay()];
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const isToday = date.getTime() === today.getTime();
        const dateStr = formatDate(date);
        const isSelected = selectedDate && formatDate(selectedDate) === dateStr;
        
        html += `<th class="day-header ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSelected ? 'selected-day' : ''}"
                     onclick="selectDateAndAnalyze('${dateStr}')" style="cursor: pointer;">`;
        html += `<span class="day-name">${dayName}</span>`;
        html += `<span class="day-number">${date.getDate()}.${date.getMonth() + 1}</span>`;
        html += '</th>';
    }
    
    html += '</tr></thead><tbody>';
    
    // Nur sichtbare Techniker anzeigen (nach RSL/Team-Filter)
    const visibleTechniker = techniker.filter(tech => tech.visible !== false);
    
    if (visibleTechniker.length === 0) {
        html += '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #6c757d;">Keine Techniker entsprechen den aktuellen Filtern</td></tr>';
    } else {
        visibleTechniker.forEach(tech => {
            html += '<tr>';
            html += `<td class="tech-name">${tech.name}${tech.rsl ? ' <small style="color: #6c757d;">(' + tech.rsl + ')</small>' : ''}</td>`;
        
            days.forEach(date => {
                const dateStr = formatDate(date);
                const status = getScheduleStatus(tech.id, dateStr);
                const isPast = date < today;
            
                const bgColor = STATUS_TYPES[status]?.color || '#f8f9fa';
                const textColor = STATUS_TYPES[status]?.textColor || '#000';
            
                html += '<td>';
                html += `<div class="schedule-cell ${isPast ? 'disabled' : ''}"
                          style="background-color: ${bgColor}; color: ${textColor}; ${isPast ? 'opacity: 0.4;' : ''} font-weight: bold;"
                          onclick="${isPast ? '' : `handleScheduleCellClick(${tech.id}, '${dateStr}', this)`}">`;
                html += status;
                html += '</div>';
                html += '</td>';
            });
        
            html += '</tr>';
        });
    }
    
    html += '</tbody></table>';
    document.getElementById('fullscreenScheduleCalendar').innerHTML = html;
}

// Tag-Schedule kopieren
// Hilfsfunktion: Datum formatieren als YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ===== HILFE FUNKTIONEN =====

// Hilfe-Panel öffnen/schließen
function toggleHelpPanel() {
    const panel = document.getElementById('helpPanel');
    panel.classList.toggle('open');
    panel.classList.remove('minimized');
}

// Hilfe-Panel Breite verstellbar machen
function initHelpPanelResize() {
    const panel = document.getElementById('helpPanel');
    const handle = document.getElementById('helpResizeHandle');
    
    if (!handle) return;
    
    let isResizing = false;
    let startX, startWidth;
    
    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        e.preventDefault();
        
        // Disable transition während resize
        panel.style.transition = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        // Berechne neue Breite (nach links ziehen = breiter)
        const deltaX = startX - e.clientX;
        const newWidth = startWidth + deltaX;
        
        // Min/Max Breiten beachten
        const clampedWidth = Math.max(300, Math.min(800, newWidth));
        panel.style.width = clampedWidth + 'px';
        
        // Update right position wenn offen
        if (panel.classList.contains('open')) {
            panel.style.right = '0';
        } else {
            panel.style.right = `-${clampedWidth}px`;
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            // Transition wieder aktivieren
            panel.style.transition = 'right 0.3s ease';
        }
    });
}

// Hilfe-Section auf/zuklappen
function toggleHelpSection(sectionId) {
    const content = document.getElementById(sectionId);
    const header = content.previousElementSibling;
    const toggle = header.querySelector('.help-toggle');
    
    content.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
}

// ===== END HILFE FUNKTIONEN =====

// ===== KI-ASSISTENT FUNKTIONEN =====

// OpenAI API Key speichern
function saveOpenAIKey() {
    const key = document.getElementById('openaiApiKey').value.trim();
    if (key) {
        openaiApiKey = key;
        localStorage.setItem('openai_api_key', key);
        showStatus('openaiStatus', 'OpenAI API Key erfolgreich gespeichert!', 'success');
    } else {
        showStatus('openaiStatus', 'Bitte geben Sie einen API Key ein.', 'error');
    }
}

// Nachricht an KI senden
// KI-Gesprächsverlauf (für mehrstufige Konversation)
let aiConversationHistory = [];

async function sendAIMessage() {
    const input = document.getElementById('aiInput');
    const question = input.value.trim();

    if (!question) return;

    if (!openaiApiKey) {
        addAIMessage('❌ Bitte zuerst einen OpenAI API Key eingeben und speichern!', 'assistant');
        return;
    }

    addAIMessage(question, 'user');
    input.value = '';

    const sendBtn = document.getElementById('aiSendBtn');
    sendBtn.disabled = true;
    const loadingDiv = showAILoading();

    try {
        // Smart Context basierend auf der Frage aufbauen
        const { context: rawContext, summary } = buildSmartContext(question);
        const context = anonymizeContext(rawContext);

        // Strategie-Modus oder Neuer-Techniker-Frage → erweiterter Prompt
        const isNewTechQuestion = /neuer?\s*tech|einstell|hire|neueinstellung|empfehl.*tech|tech.*empfehl|wo.*tech|standort.*tech|erweiter|lücke|gap/.test(question.toLowerCase());
        const isStrategyMode = appMode === 'strategy';

        const systemPrompt = `Du bist ein KI-Assistent für eine Techniker-Einsatzplanung.

ABSOLUTE REGEL: Du hast ALLE relevanten Daten in diesem Kontext. Frage NIEMALS nach weiteren Daten oder Informationen. Wenn du etwas nicht siehst, bedeutet das: nicht eingetragen — triff trotzdem eine konkrete Aussage.

${isNewTechQuestion || isStrategyMode ? `SPEZIALAUFGABE — NEUER TECHNIKER EMPFEHLUNG:
Du hast Cluster-Daten von nicht abgedeckten Kunden. Gib für jeden relevanten Cluster KONKRET an:

**Empfehlung Cluster [Nr]:**
• Wohnort: [Stadt/Region — nutze dein Geografie-Wissen für die Koordinaten]
• Priorität: [Hoch/Mittel] — [X] Kunden, [Y] Geräte
• Benötigte Skills: [Skills nach Häufigkeit sortiert]
• Wirkung: Mit diesem Techniker werden [X] Kunden neu abgedeckt
• Begründung: [1 Satz warum genau dieser Standort]

Wenn mehrere Cluster vorhanden: Empfehle zuerst den mit dem größten Potenzial.
Sei mutig — mach konkrete Aussagen auch wenn die Daten nicht 100% vollständig sind.

` : `AUFGABE:
1. Beantworte die Frage direkt — keine langen Einleitungen
2. Bei Problemen: sofortiger Lösungsvorschlag mit echten Namen (z.B. "→ Techniker Müller könnte einspringen")
3. Leere Daten interpretieren: Kein Kalender = verfügbar, keine Isochrone = Reichweite unbekannt
`}
Formatiere: • für Aufzählungen, → für Lösungen, **fett** für wichtige Punkte.
STATUS-CODES: ZR=Bereitschaft, X=Abwesend, I=Installation, W=Wartung, K=Krank, U=Urlaub
Antworte auf Deutsch, präzise und direkt.

AKTUELLER KONTEXT:
${context}`;

        // Gesprächsverlauf + neue Nutzerfrage
        const messages = [
            { role: 'system', content: systemPrompt },
            ...aiConversationHistory,
            { role: 'user', content: question }
        ];

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: messages,
                temperature: 0.2,
                max_tokens: 1500
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`API-Fehler: ${response.status} - ${errorData.error?.message || 'Unbekannter Fehler'}`);
        }

        const data = await response.json();
        const answer = data.choices[0].message.content;

        // Gesprächsverlauf aktualisieren (max. 6 Nachrichten = 3 Runden)
        aiConversationHistory.push({ role: 'user', content: question });
        aiConversationHistory.push({ role: 'assistant', content: answer });
        if (aiConversationHistory.length > 6) {
            aiConversationHistory = aiConversationHistory.slice(-6);
        }

        loadingDiv.remove();
        addAIMessage(answer, 'assistant');

        // COG-Buttons anzeigen wenn Kandidaten berechnet wurden
        if (cogCandidates.length > 0 && (isNewTechQuestion || isStrategyMode)) {
            showCOGButtons();
        }

        // Kleinen Hinweis anzeigen was gefiltert wurde
        if (summary || aiAnonEnabled) {
            const anonNote = aiAnonEnabled ? ' | 🔒 Namen anonymisiert' : '';
            addAIMessage(`ℹ️ <em>Kontext: ${summary || 'Allgemein'}${anonNote}</em>`, 'system');
        }

    } catch (error) {
        console.error('KI-Assistent Fehler:', error);
        loadingDiv.remove();

        let errorMessage = '❌ Fehler beim Kontaktieren des KI-Assistenten.';
        if (error.message.includes('401')) {
            errorMessage += '\n\n🔑 Ihr API Key ist ungültig. Bitte überprüfen Sie ihn.';
        } else if (error.message.includes('429')) {
            errorMessage += '\n\n⏱️ Rate Limit erreicht. Bitte warten Sie kurz.';
        } else if (error.message.includes('insufficient_quota')) {
            errorMessage += '\n\n💳 Ihr OpenAI Guthaben ist aufgebraucht.';
        } else {
            errorMessage += '\n\n' + error.message;
        }
        addAIMessage(errorMessage, 'assistant');
    } finally {
        sendBtn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════
// ANONYMISIERUNG
// ═══════════════════════════════════════════════════════════════

function saveAnonSetting() {
    aiAnonEnabled = document.getElementById('aiAnonToggle').checked;
    localStorage.setItem('ai_anon_enabled', aiAnonEnabled ? '1' : '0');
    buildAnonMap();
    updateAnonToggleUI();
}

function updateAnonToggleUI() {
    const box      = document.getElementById('aiAnonToggleBox');
    const textEl   = document.getElementById('aiAnonText');
    const hintEl   = document.getElementById('aiAnonHint');
    if (!box) return;
    if (aiAnonEnabled) {
        box.classList.add('is-active');
        if (textEl) textEl.textContent = '🔒 Anonymisierung aktiv';
        if (hintEl) hintEl.textContent = 'Namen werden als Kunde_001, Techniker_A gesendet';
    } else {
        box.classList.remove('is-active');
        if (textEl) textEl.textContent = '🔓 Anonymisierung aus';
        if (hintEl) hintEl.textContent = 'Namen werden an OpenAI gesendet';
    }
}

function loadAnonSetting() {
    const saved = localStorage.getItem('ai_anon_enabled');
    if (saved === '1') {
        aiAnonEnabled = true;
        const toggle = document.getElementById('aiAnonToggle');
        if (toggle) toggle.checked = true;
    }
    updateAnonToggleUI();
}

// Erstellt stabile Pseudonyme für alle Techniker und Kunden
function buildAnonMap() {
    anonMap = {};
    anonMapReverse = {};

    // Techniker: A, B, C, ... Z, AA, AB, ...
    techniker.forEach((t, i) => {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const pseudo = i < 26
            ? 'Techniker_' + letters[i]
            : 'Techniker_' + letters[Math.floor(i / 26) - 1] + letters[i % 26];
        anonMap[t.name] = pseudo;
        anonMapReverse[pseudo] = t.name;
        // Auch RSL/Team anonymisieren
        if (t.rsl) {
            if (!anonMap['team_' + t.rsl]) {
                const teamIdx = Object.keys(anonMap).filter(k => k.startsWith('team_')).length;
                const teamPseudo = 'Team_' + (teamIdx + 1);
                anonMap['team_' + t.rsl] = teamPseudo;
                anonMapReverse[teamPseudo] = t.rsl;
            }
        }
    });

    // Kunden: Kunde_001, Kunde_002, ...
    kunden.forEach((k, i) => {
        const pseudo = 'Kunde_' + String(i + 1).padStart(3, '0');
        anonMap[k.name] = pseudo;
        anonMapReverse[pseudo] = k.name;
    });
}

// Anonymisiert einen Kontext-String: ersetzt alle echten Namen
function anonymizeContext(text) {
    if (!aiAnonEnabled) return text;
    buildAnonMap();

    let result = text;

    // Techniker-Namen ersetzen (längere Namen zuerst, um Teilersetzungen zu vermeiden)
    const techEntries = techniker
        .map(t => [t.name, anonMap[t.name]])
        .sort((a, b) => b[0].length - a[0].length);

    techEntries.forEach(([real, pseudo]) => {
        result = result.split(real).join(pseudo);
        // Auch Team-Name
        if (anonMap['team_' + techniker.find(t => t.name === real)?.rsl]) {
            const teamReal = techniker.find(t => t.name === real)?.rsl;
            const teamPseudo = anonMap['team_' + teamReal];
            if (teamReal && teamPseudo) {
                result = result.split(teamReal).join(teamPseudo);
            }
        }
    });

    // Kunden-Namen ersetzen
    const kundenEntries = kunden
        .map(k => [k.name, anonMap[k.name]])
        .sort((a, b) => b[0].length - a[0].length);

    kundenEntries.forEach(([real, pseudo]) => {
        result = result.split(real).join(pseudo);
    });

    return result;
}


// -------------------------------------------------------
// SMART CONTEXT BUILDER
// -------------------------------------------------------

function buildSmartContext(question) {
    const q = question.toLowerCase();

    // ── 1. INTENT DETECTION ──────────────────────────────
    const wantsSchedule = /woch|tag|datum|kalend|verfügbar|abwes|urlaub|krank|plan|nächste|diese|zeitraum|einsatz/.test(q);
    const wantsCoverage = /abdeckung|coverage|reich|isochron|kunde|abgedeckt|service|wartung/.test(q);
    const wantsNewTech  = /neuer?\s*tech|einstell|hire|neueinstellung|empfehl.*tech|tech.*empfehl|wo.*tech|standort.*tech|tech.*standort|erweiter|lücke|gap/.test(q);

    // ── 2. TEAM/TECHNIKER-FILTER ─────────────────────────
    let filteredTechs = techniker;
    let teamName = null;

    const teamMatch = q.match(/team\s+([a-züöäß\-]+)/i);
    if (teamMatch) {
        teamName = teamMatch[1];
        filteredTechs = techniker.filter(t =>
            t.rsl && t.rsl.toLowerCase().includes(teamName.toLowerCase())
        );
        if (filteredTechs.length === 0) {
            filteredTechs = techniker.filter(t =>
                t.name.toLowerCase().includes(teamName.toLowerCase())
            );
        }
    } else {
        for (const tech of techniker) {
            const nameParts = tech.name.toLowerCase().split(/\s+/);
            if (nameParts.some(part => part.length > 3 && q.includes(part))) {
                filteredTechs = [tech];
                teamName = tech.name;
                break;
            }
        }
        if (filteredTechs.length === techniker.length) {
            const allRSLs = [...new Set(techniker.map(t => t.rsl).filter(Boolean))];
            for (const rsl of allRSLs) {
                if (rsl.length > 2 && q.includes(rsl.toLowerCase())) {
                    filteredTechs = techniker.filter(t => t.rsl === rsl);
                    teamName = rsl;
                    break;
                }
            }
        }
    }

    // ── 3. DATUMSBEREICH ─────────────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let dateFrom = new Date(today);
    let dateTo = new Date(today);
    let dateLabel = 'heute';

    const weekMatch = q.match(/(\d+)\s*woch/);
    const dayMatch  = q.match(/(\d+)\s*tag/);

    if (weekMatch) {
        dateTo = new Date(today);
        dateTo.setDate(dateTo.getDate() + parseInt(weekMatch[1]) * 7);
        dateLabel = `nächste ${weekMatch[1]} Woche(n)`;
    } else if (dayMatch) {
        dateTo = new Date(today);
        dateTo.setDate(dateTo.getDate() + parseInt(dayMatch[1]));
        dateLabel = `nächste ${dayMatch[1]} Tage`;
    } else if (/nächste\s*woche/.test(q)) {
        const dow = today.getDay() || 7;
        dateFrom = new Date(today); dateFrom.setDate(today.getDate() + (8 - dow));
        dateTo = new Date(dateFrom); dateTo.setDate(dateFrom.getDate() + 6);
        dateLabel = 'nächste Woche';
    } else if (/diese\s*woche/.test(q)) {
        const dow = today.getDay() || 7;
        dateFrom = new Date(today); dateFrom.setDate(today.getDate() - dow + 1);
        dateTo = new Date(dateFrom); dateTo.setDate(dateFrom.getDate() + 6);
        dateLabel = 'diese Woche';
    } else if (/nächste[nm]?\s*monat/.test(q)) {
        dateFrom = new Date(today.getFullYear(), today.getMonth() + 1, 1);
        dateTo   = new Date(today.getFullYear(), today.getMonth() + 2, 0);
        dateLabel = 'nächsten Monat';
    } else if (wantsSchedule) {
        dateTo.setDate(dateTo.getDate() + 14);
        dateLabel = 'nächste 14 Tage';
    }

    // ── 4. KONTEXT BAUEN ─────────────────────────────────
    let context = '';
    const summaryParts = [];
    if (teamName) summaryParts.push(`Fokus: "${teamName}" (${filteredTechs.length} Techniker)`);
    if (wantsSchedule) summaryParts.push(`Zeitraum: ${dateLabel}`);

    // ── A) TECHNIKER DETAIL ───────────────────────────────
    const isFiltered = filteredTechs.length < techniker.length;
    context += `👷 TECHNIKER (${filteredTechs.length}${isFiltered ? ' gefiltert' : ''} von ${techniker.length} gesamt):\n`;

    filteredTechs.forEach(tech => {
        const skills = tech.skills && tech.skills.length > 0 ? tech.skills.join(', ') : 'keine Skills eingetragen';
        const teamInfo = tech.rsl ? ` | Team: ${tech.rsl}` : '';

        // Zugewiesene Geräte/Kunden zählen
        const assignedDevices = [];
        let assignedCustomerCount = 0;
        kunden.forEach(k => {
            if (!k.deviceAssignments) return;
            const myDevices = Object.entries(k.deviceAssignments)
                .filter(([, tId]) => tId === tech.id)
                .map(([deviceKey]) => deviceKey.replace(/_\d+$/, ''));
            if (myDevices.length > 0) {
                assignedCustomerCount++;
                myDevices.forEach(d => assignedDevices.push(d));
            }
        });
        const deviceCount = assignedDevices.length;
        const loadInfo = assignedCustomerCount > 0
            ? ` | Zugewiesen: ${assignedCustomerCount} Kunden / ${deviceCount} Geräte`
            : ' | Keine Zuweisung';

        context += `\n• ${tech.name} (${tech.active ? '✅ aktiv' : '❌ inaktiv'}) | Skills: ${skills}${teamInfo}${loadInfo}\n`;

        // Kalender-Analyse
        const days = getDaysInRange(dateFrom, dateTo);
        const workdays = days.filter(d => !isWeekendStr(d));
        const statusEntries = {};
        const problemDays = [];
        const availableDays = [];

        workdays.forEach(dateStr => {
            const st = getScheduleStatus(tech.id, dateStr);
            if (st) {
                statusEntries[st] = (statusEntries[st] || 0) + 1;
                if (st === 'K' || st === 'X' || st === 'U') {
                    problemDays.push(`${dateStr}→${STATUS_TYPES[st]?.label || st}`);
                } else if (st === 'ZR') {
                    availableDays.push(dateStr);
                }
            } else {
                availableDays.push(dateStr); // kein Eintrag = verfügbar
            }
        });

        const hasAnySchedule = Object.keys(schedule[tech.id] || {}).length > 0;

        if (wantsSchedule) {
            if (!hasAnySchedule) {
                context += `  📅 ${dateLabel}: Kein Kalender gepflegt → alle ${workdays.length} Arbeitstage technisch verfügbar (kein Ausfall gemeldet)\n`;
            } else {
                context += `  📅 ${dateLabel}: ${availableDays.length}/${workdays.length} Arbeitstage verfügbar`;
                if (Object.keys(statusEntries).length > 0) {
                    const breakdown = Object.entries(statusEntries)
                        .map(([s, c]) => `${STATUS_TYPES[s]?.label || s}:${c}d`)
                        .join(', ');
                    context += ` | ${breakdown}`;
                }
                context += '\n';
                if (problemDays.length > 0) {
                    context += `  ⚠️ Ausfälle: ${problemDays.slice(0, 8).join(', ')}${problemDays.length > 8 ? ` +${problemDays.length - 8} weitere` : ''}\n`;
                }
            }

            // Kritisch: Ausfallquote berechnen
            if (workdays.length > 0) {
                const ausfallQuote = Math.round((problemDays.length / workdays.length) * 100);
                if (ausfallQuote >= 30) {
                    context += `  🔴 KRITISCH: ${ausfallQuote}% Ausfallquote im Zeitraum\n`;
                } else if (ausfallQuote >= 15) {
                    context += `  🟡 HINWEIS: ${ausfallQuote}% Ausfallquote\n`;
                }
            }
        }

        // Isochronen-Abdeckung
        if (wantsCoverage && isochroneGeoJSON.length > 0 && tech.active) {
            const isoData = isochroneGeoJSON.find(iso => iso.techId === tech.id);
            if (isoData) {
                const inRange = kunden.filter(k => isPointInPolygon(k.lng, k.lat, isoData.feature.geometry));
                const withSkill = inRange.filter(k => customerMatchesTechSkills(k, tech));
                const withoutSkill = inRange.filter(k => !customerMatchesTechSkills(k, tech));
                context += `  🗺️ Fahrreichweite: ${inRange.length} Kunden erreichbar`;
                context += ` | ${withSkill.length} mit Skill-Match, ${withoutSkill.length} ohne Skill\n`;
                if (withoutSkill.length > 0) {
                    context += `  → Erreichbar aber Skill fehlt: ${withoutSkill.slice(0, 4).map(k => k.name).join(', ')}${withoutSkill.length > 4 ? ` +${withoutSkill.length - 4}` : ''}\n`;
                }
            } else {
                context += `  🗺️ Keine Isochrone geladen für diesen Techniker\n`;
            }
        }
    });

    // ── B) KUNDEN-ABDECKUNG ───────────────────────────────
    if (wantsCoverage || (!wantsSchedule && !isFiltered)) {
        const techIds = new Set(filteredTechs.map(t => t.id));

        // Kunden die diesem Team zugewiesen sind (via deviceAssignments)
        const assignedCustomers = kunden.filter(k => {
            if (!k.deviceAssignments) return false;
            return Object.values(k.deviceAssignments).some(tId => techIds.has(tId));
        });
        const customerSet = assignedCustomers.length > 0 ? assignedCustomers : kunden;
        const setLabel = assignedCustomers.length > 0 ? 'diesem Team zugewiesen' : 'gesamt';

        const covered   = customerSet.filter(k => k.covered);
        const uncovered = customerSet.filter(k => !k.covered);
        const partial   = customerSet.filter(k => {
            if (!k.deviceAssignments || !k.instrumentLines) return false;
            const assigned = Object.keys(k.deviceAssignments).length;
            return assigned > 0 && assigned < k.instrumentLines.length;
        });

        context += `\n📦 KUNDEN (${setLabel}): ${customerSet.length} gesamt`;
        context += ` | ✅ Abgedeckt: ${covered.length}`;
        context += ` | ❌ Nicht abgedeckt: ${uncovered.length}`;
        if (partial.length > 0) context += ` | ⚠️ Teilweise: ${partial.length}`;
        context += '\n';

        // Nicht abgedeckte Kunden mit Analyse
        if (uncovered.length > 0) {
            context += `\n❌ NICHT ABGEDECKTE KUNDEN (${uncovered.length}):\n`;
            uncovered.slice(0, 20).forEach(k => {
                const devices = k.instrumentLines && k.instrumentLines.length > 0
                    ? k.instrumentLines.join(', ')
                    : 'keine Geräte eingetragen';
                const deviceCount = k.instrumentLines ? k.instrumentLines.length : 0;

                // Analysiere Abdeckungsgrund
                let reason = '';
                if (isochroneGeoJSON.length > 0) {
                    const inAnyRange = isochroneGeoJSON.some(iso =>
                        isPointInPolygon(k.lng, k.lat, iso.feature.geometry)
                    );
                    if (!inAnyRange) {
                        reason = ' → GRUND: Außerhalb aller Fahrzonen';
                    } else {
                        // Finde welcher Tech in Reichweite aber kein Skill
                        const techsInRange = isochroneGeoJSON
                            .filter(iso => isPointInPolygon(k.lng, k.lat, iso.feature.geometry))
                            .map(iso => techniker.find(t => t.id === iso.techId))
                            .filter(Boolean);
                        reason = ` → GRUND: In Reichweite von ${techsInRange.map(t => t.name).join(', ')} aber Skill fehlt`;
                    }
                } else {
                    // Kein Isochron: prüfe ob überhaupt ein Assignment existiert
                    const hasAssignment = k.deviceAssignments && Object.keys(k.deviceAssignments).length > 0;
                    reason = hasAssignment ? ' → Teilweise zugewiesen, aber nicht vollständig abgedeckt' : ' → Kein Techniker zugewiesen';
                }

                context += `  • ${k.name} | ${deviceCount} Gerät(e): ${devices}${reason}\n`;
            });
            if (uncovered.length > 20) {
                context += `  ... und ${uncovered.length - 20} weitere\n`;
            }
        }
    }

    // ── C) ALTERNATIVE TECHNIKER (für Empfehlungen) ──────
    const filteredIds = new Set(filteredTechs.map(t => t.id));
    const otherTechs = techniker.filter(t => t.active && !filteredIds.has(t.id));
    if (otherTechs.length > 0 && isFiltered) {
        context += `\n🔄 ANDERE VERFÜGBARE TECHNIKER (für Empfehlungen):\n`;
        otherTechs.slice(0, 10).forEach(t => {
            const skills = t.skills && t.skills.length > 0 ? t.skills.join(', ') : 'keine';
            const teamInfo = t.rsl ? ` | Team: ${t.rsl}` : '';
            context += `  • ${t.name} | Skills: ${skills}${teamInfo}\n`;
        });
        if (otherTechs.length > 10) context += `  ... und ${otherTechs.length - 10} weitere\n`;
    }

    // ── D) ISOCHRONEN-STATUS ──────────────────────────────
    if (isochroneGeoJSON.length === 0) {
        context += `\nℹ️ HINWEIS: Keine Fahrzonen (Isochronen) geladen → Reichweiten-Analyse nicht möglich. Abdeckung basiert auf manuellen Zuweisungen.\n`;
    }

    // ── E) CENTER OF GRAVITY — OPTIMALER STANDORT NEUER TECHNIKER ──
    if ((wantsNewTech || appMode === 'strategy') && isochroneGeoJSON.length > 0) {
        const cogResult = computeCenterOfGravity();
        context += cogResult;
    } else if ((wantsNewTech || appMode === 'strategy') && isochroneGeoJSON.length === 0) {
        context += `\nℹ️ Center-of-Gravity-Analyse: Bitte zuerst Isochronen laden für präzise Standortempfehlung.\n`;
    }

    const summary = summaryParts.length > 0 ? summaryParts.join(' | ') : null;
    return { context, summary };
}
// ═══════════════════════════════════════════════════════════════
// CENTER OF GRAVITY ENGINE
// Findet den optimalen Wohnort für einen neuen Techniker basierend
// auf allen Kunden, Geräten, Skills und bestehender Abdeckung.
// Scoring: +Geräte die neu abgedeckt werden, -Redundanz-Penalty
// ═══════════════════════════════════════════════════════════════

function computeCenterOfGravity() {
    const visibleKunden = kunden.filter(k => k.visible !== false && k.instrumentLines && k.instrumentLines.length > 0);
    if (visibleKunden.length === 0) return '\nKeine Kunden für CoG-Analyse vorhanden.\n';
    if (isochroneGeoJSON.length === 0) return '\nBitte zuerst Isochronen laden.\n';

    // ── Fahrradius aus Median der Isochronen ──────────────────────
    let radiusDeg = 0.6;
    const radii = isochroneGeoJSON.map(iso => {
        const coords = iso.feature.geometry.type === 'Polygon'
            ? iso.feature.geometry.coordinates[0]
            : iso.feature.geometry.coordinates[0][0];
        if (!coords || coords.length === 0) return 0.6;
        const lats = coords.map(c => c[1]);
        const lngs = coords.map(c => c[0]);
        return Math.max(
            (Math.max(...lats) - Math.min(...lats)) / 2,
            (Math.max(...lngs) - Math.min(...lngs)) / 2
        );
    }).filter(r => r > 0);
    if (radii.length > 0) {
        radii.sort((a, b) => a - b);
        radiusDeg = radii[Math.floor(radii.length / 2)];
    }

    // ── Aktuelle Abdeckungsanzahl pro Kunde berechnen ─────────────
    // coverageCount[kundeId] = Anzahl Techniker die diesen Kunden abdecken (Skill + Reichweite)
    const coverageCount = {};
    visibleKunden.forEach(k => { coverageCount[k.id] = 0; });

    isochroneGeoJSON.forEach(iso => {
        const tech = techniker.find(t => t.id === iso.techId);
        if (!tech) return;
        visibleKunden.forEach(k => {
            if (!isPointInPolygon(k.lng, k.lat, iso.feature.geometry)) return;
            // Skill-Check: mind. ein Gerät des Kunden muss matchen
            const hasSkill = (k.instrumentLines || []).some(dev => {
                if (!dev || !dev.trim()) return false;
                return tech.skills && tech.skills.some(skill => {
                    const escaped = skill.toLowerCase().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    return new RegExp('\\b' + escaped + '\\b', 'i').test(dev.toLowerCase());
                });
            });
            if (hasSkill) coverageCount[k.id]++;
        });
    });

    // ── Dichte-Analyse: Wie viele Techniker gibt es pro Region? ──
    // Bestimmt dynamisch den Ziel-Overlap (3 in dünn, 6-7 in dicht)
    const totalTechs = isochroneGeoJSON.length;
    const avgCoverage = visibleKunden.reduce((s, k) => s + coverageCount[k.id], 0) / visibleKunden.length;
    // Ziel: ~3 Überlappungen in dünn besiedelten Gebieten, skaliert mit Dichte
    const targetOverlap = Math.min(7, Math.max(3, Math.round(avgCoverage + 1)));

    // ── Bounding Box ──────────────────────────────────────────────
    const allLats = visibleKunden.map(k => k.lat);
    const allLngs = visibleKunden.map(k => k.lng);
    const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);
    const minLng = Math.min(...allLngs), maxLng = Math.max(...allLngs);

    const gridSteps = Math.min(40, Math.max(20, Math.round(
        Math.max(maxLat - minLat, maxLng - minLng) / radiusDeg * 8
    )));
    const stepLat = (maxLat - minLat) / gridSteps;
    const stepLng = (maxLng - minLng) / gridSteps;

    // ── Grid-Search ───────────────────────────────────────────────
    // Score pro Kandidat: Summe der Punkte für jeden Kunden in Reichweite
    // Punktvergabe je nach aktuellem Coverage-Count des Kunden:
    //   Aktuell 0 Abdeckungen:        0 Punkte (kein Skill-Overlap → irrelevant)
    //   Aktuell 1 Abdeckung:          1 Punkt  (wird zu 2 → noch unter Ziel)
    //   Aktuell 2 Abdeckungen:        3 Punkte (wird zu 3 → Ziel erreicht, Maximum)
    //   Aktuell target-1 Abdeckungen: 3 Punkte (immer Maximum kurz vor Ziel)
    //   Aktuell >= target Abdeckungen: 0.5 Punkte (über Ziel → kaum wertvoll)
    const bestCandidates = [];

    for (let i = 0; i <= gridSteps; i++) {
        for (let j = 0; j <= gridSteps; j++) {
            const candLat = minLat + i * stepLat;
            const candLng = minLng + j * stepLng;

            // Kunden in Reichweite
            const inRange = visibleKunden.filter(k => {
                const dLat = k.lat - candLat;
                const dLng = (k.lng - candLng) * Math.cos(candLat * Math.PI / 180);
                return Math.sqrt(dLat * dLat + dLng * dLng) <= radiusDeg;
            });
            if (inRange.length === 0) continue;

            // Score berechnen
            let score = 0;
            let atTarget = 0;         // Kunden die genau auf Ziel-Overlap kommen
            let belowTarget = 0;      // Kunden die unter Ziel bleiben
            let aboveTarget = 0;      // Kunden die schon über Ziel sind

            // Skills die an diesem Standort gebraucht werden
            const skillDemand = {};

            inRange.forEach(k => {
                const cc = coverageCount[k.id];
                if (cc === 0) {
                    // Kein Techniker deckt diesen Kunden ab → für Redundanz nicht relevant
                    score += 0;
                } else if (cc < targetOverlap - 1) {
                    score += 1;
                    belowTarget++;
                } else if (cc === targetOverlap - 1) {
                    // Dieser Kunde erreicht genau das Ziel → maximaler Wert
                    score += 3;
                    atTarget++;
                } else {
                    // Bereits über Ziel → minimaler Bonus (trotzdem etwas wert)
                    score += 0.5;
                    aboveTarget++;
                }

                // Skills zählen
                (k.instrumentLines || []).forEach(dev => {
                    if (dev && dev.trim()) skillDemand[dev] = (skillDemand[dev] || 0) + 1;
                });
            });

            if (score <= 0) continue;

            const topSkills = Object.entries(skillDemand)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([s, c]) => `${s}(${c}x)`);

            bestCandidates.push({
                lat: candLat, lng: candLng, score,
                customersInRange: inRange.length,
                atTarget, belowTarget, aboveTarget,
                topSkills,
                customers: inRange
            });
        }
    }

    if (bestCandidates.length === 0) {
        return '\n✅ CENTER OF GRAVITY: Alle Kunden haben bereits optimale Redundanz.\n';
    }

    bestCandidates.sort((a, b) => b.score - a.score);

    // ── Top-3 Kandidaten deduplizieren ────────────────────────────
    const topCandidates = [];
    for (const cand of bestCandidates) {
        const tooClose = topCandidates.some(c => {
            const d = Math.sqrt(Math.pow(c.lat - cand.lat, 2) + Math.pow(c.lng - cand.lng, 2));
            return d < radiusDeg * 0.5;
        });
        if (!tooClose) topCandidates.push(cand);
        if (topCandidates.length >= 3) break;
    }

    // ── Ergebnis für KI-Kontext ───────────────────────────────────
    let result = `\n🎯 CENTER OF GRAVITY — OPTIMALE REDUNDANZ-STANDORTE:\n`;
    result += `Grundlage: ${visibleKunden.length} Kunden | ${totalTechs} bestehende Techniker\n`;
    result += `Durchschnittliche Abdeckung: ${avgCoverage.toFixed(1)}x pro Kunde\n`;
    result += `Ziel-Überlappung: ${targetOverlap}x (automatisch berechnet aus Dichte)\n`;
    result += `Scoring: +3 wenn Kunde Ziel-Overlap erreicht, +1 darunter, +0.5 darüber\n\n`;

    topCandidates.forEach((cand, i) => {
        const rank = ['🥇', '🥈', '🥉'][i];
        let nearestTech = '', nearestDist = Infinity;
        techniker.forEach(t => {
            const d = Math.sqrt(Math.pow(t.lat - cand.lat, 2) + Math.pow(t.lng - cand.lng, 2));
            if (d < nearestDist) { nearestDist = d; nearestTech = t.name; }
        });

        result += `${rank} STANDORT ${i + 1} | Score: ${Math.round(cand.score)}\n`;
        result += `  📍 Koordinaten: ${cand.lat.toFixed(4)}, ${cand.lng.toFixed(4)}\n`;
        result += `  👥 Kunden in Reichweite: ${cand.customersInRange}\n`;
        result += `  🎯 Erreichen Ziel (${targetOverlap}x): ${cand.atTarget} Kunden\n`;
        result += `  📊 Unter Ziel: ${cand.belowTarget} | Über Ziel: ${cand.aboveTarget}\n`;
        result += `  🔧 Geräte in Reichweite: ${cand.topSkills.join(', ')}\n`;
        result += `  📏 Nächster Techniker: ${nearestTech} (~${Math.round(nearestDist * 111)} km)\n`;
        result += `  🏢 Beispielkunden: ${cand.customers.slice(0, 4).map(k => k.name).join(', ')}${cand.customers.length > 4 ? ` +${cand.customers.length - 4} weitere` : ''}\n\n`;
    });

    result += `AUFGABE: Benenne für jeden Standort die Stadt/Region (aus den Koordinaten).\n`;
    result += `Erkläre warum Standort 1 die beste Redundanz-Balance liefert (Ziel: ${targetOverlap}x Überlappung).\n`;

    // Global speichern für Button-Aktion
    cogCandidates = topCandidates.map((c, i) => ({
        index: i,
        lat: c.lat,
        lng: c.lng,
        label: `COG Kandidat ${i + 1}`,
        score: Math.round(c.score),
        customersInRange: c.customersInRange,
        atTarget: c.atTarget
    }));

    return result;
}

// Hilfsfunktion: Alle Datumstrings zwischen zwei Daten
function getDaysInRange(from, to) {
    const days = [];
    const cur = new Date(from);
    while (cur <= to) {
        days.push(formatDate(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

// Hilfsfunktion: Ist ein Datum-String (YYYY-MM-DD) ein Wochenende?
function isWeekendStr(dateStr) {
    const d = new Date(dateStr);
    return d.getDay() === 0 || d.getDay() === 6;
}

// Hilfsfunktion: Passt ein Kunde zu den Skills eines Technikers?
function customerMatchesTechSkills(kunde, tech) {
    if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) return true;
    return kunde.instrumentLines.some(instrumentLine => {
        if (!instrumentLine || !instrumentLine.trim()) return false;
        const instrumentName = instrumentLine.toLowerCase();
        return tech.skills && tech.skills.some(skill => {
            const skillLower = skill.toLowerCase().trim();
            const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
            return regex.test(instrumentName);
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// COG SIMULATIONS-FENSTER
// ═══════════════════════════════════════════════════════════════

let cogSimOpen = false;
let cogKundenFilter = 'all';

function toggleCogSimWindow() {
    const win = document.getElementById('cogSimWindow');
    cogSimOpen = !cogSimOpen;
    win.classList.toggle('active', cogSimOpen);
    if (cogSimOpen) refreshCOGSim();
}

function openCogSimWindow() {
    const win = document.getElementById('cogSimWindow');
    cogSimOpen = true;
    win.classList.add('active');
    refreshCOGSim();
}

// Hauptfunktion: Fenster aktualisieren
function refreshCOGSim() {
    updateCogKPIs();
    renderCogCandidates();
    renderCogIsochroneToggles();
    renderCogKunden();
}

// ── KPIs ─────────────────────────────────────────────────────
function updateCogKPIs() {
    const visKunden = kunden.filter(k => k.visible !== false);
    const totalDevices = visKunden.reduce((s, k) =>
        s + (k.instrumentLines || []).filter(d => d && d.trim()).length, 0);
    const covDevices = visKunden.reduce((s, k) => s + (k.coveredDevices || 0), 0);
    const pct = totalDevices > 0 ? Math.round(covDevices / totalDevices * 100) : 0;

    // Fahrradius aus Isochronen (Median)
    let radiusKm = '—';
    if (isochroneGeoJSON.length > 0) {
        const radii = isochroneGeoJSON.filter(iso => !iso.isCandidate).map(iso => {
            const coords = iso.feature.geometry.type === 'Polygon'
                ? iso.feature.geometry.coordinates[0]
                : iso.feature.geometry.coordinates[0][0];
            if (!coords || !coords.length) return 0;
            const lats = coords.map(c => c[1]);
            const lngs = coords.map(c => c[0]);
            return Math.max(
                (Math.max(...lats) - Math.min(...lats)) / 2,
                (Math.max(...lngs) - Math.min(...lngs)) / 2
            );
        }).filter(r => r > 0).sort((a, b) => a - b);
        if (radii.length > 0) radiusKm = Math.round(radii[Math.floor(radii.length / 2)] * 111) + ' km';
    }

    // Ziel-Overlap
    const avgCov = visKunden.length > 0
        ? visKunden.reduce((s, k) => s + (k.covered ? 1 : 0), 0) / visKunden.length
        : 0;
    const target = Math.min(7, Math.max(3, Math.round(
        isochroneGeoJSON.filter(i => !i.isCandidate).length / Math.max(1, visKunden.length) * visKunden.length / Math.max(1, visKunden.length) + 1
    )));

    document.getElementById('cogKpiKunden').textContent = visKunden.length;
    document.getElementById('cogKpiGeraete').textContent = totalDevices;
    document.getElementById('cogKpiAbdeckung').textContent = pct + '%';
    document.getElementById('cogKpiZiel').textContent = target + 'x';
    document.getElementById('cogKpiRadius').textContent = radiusKm;
}

// ── KANDIDATEN-LISTE ─────────────────────────────────────────
function renderCogCandidates() {
    const list = document.getElementById('cogCandidatesList');
    if (!cogCandidates || cogCandidates.length === 0) {
        list.innerHTML = '<div class="cog-empty">Noch keine Analyse.<br>Stelle eine Frage im KI-Chat<br>(z.B. "Empfiehl einen neuen Techniker")</div>';
        return;
    }

    const ranks = ['🥇', '🥈', '🥉'];
    list.innerHTML = cogCandidates.map((c, i) => {
        const hasIso = isochroneGeoJSON.find(iso => iso.techId === `cog_candidate_${i}`);
        const skillsHtml = (c.topSkills || []).slice(0, 5).map(s =>
            `<span class="cog-skill-chip">${s}</span>`
        ).join('');

        return `
        <div class="cog-candidate-card rank-${i+1}">
            <div class="cog-card-header">
                <span class="cog-card-rank">${ranks[i] || '📍'}</span>
                <span class="cog-card-title">${c.label}</span>
                <span class="cog-card-score">Score ${c.score}</span>
            </div>
            <div class="cog-card-body">
                <div class="cog-card-row">
                    <span class="cog-card-row-label">📍 Koordinaten</span>
                    <span class="cog-card-row-val">${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</span>
                </div>
                <div class="cog-card-row">
                    <span class="cog-card-row-label">👥 Kunden in Reichweite</span>
                    <span class="cog-card-row-val">${c.customersInRange}</span>
                </div>
                <div class="cog-card-row">
                    <span class="cog-card-row-label">🎯 Erreichen Ziel-Overlap</span>
                    <span class="cog-card-row-val">${c.atTarget}</span>
                </div>
                ${c.topSkills && c.topSkills.length > 0 ? `
                <div style="margin-top:6px;">
                    <div style="font-size:10px;color:#adb5bd;margin-bottom:4px;">Geräte in Reichweite</div>
                    <div class="cog-card-skills">${skillsHtml}</div>
                </div>` : ''}
            </div>
            <div class="cog-card-actions">
                ${hasIso
                    ? `<span class="cog-iso-loaded-badge">✅ Isochrone geladen</span>
                       <button class="cog-load-iso-btn" onclick="loadCandidateIsochrone(${i})" style="flex:0.6;">🔄 Neu laden</button>`
                    : `<button class="cog-load-iso-btn" id="cog-btn-${i}" onclick="loadCandidateIsochrone(${i})">
                           📍 Echte Isochrone laden
                       </button>`
                }
                <span id="cog-status-${i}" class="cog-card-status"></span>
            </div>
        </div>`;
    }).join('');
}

// ── ISOCHRONE TOGGLES ────────────────────────────────────────
function renderCogIsochroneToggles() {
    const realList  = document.getElementById('cogIsoToggleList');
    const simList   = document.getElementById('cogIsoSimList');
    const simLabel  = document.getElementById('cogIsoSimLabel');

    const realIsos = isochroneGeoJSON.filter(iso => !iso.isCandidate);
    const simIsos  = isochroneGeoJSON.filter(iso =>  iso.isCandidate);

    realList.innerHTML = realIsos.map(iso => {
        const layerObj = isochroneLayers.find(l => l.techId === iso.techId);
        const color = layerObj ? layerObj.color.border : '#999';
        const isVisible = layerObj ? map.hasLayer(layerObj.layer) : false;
        return `
        <div class="cog-iso-toggle-item ${isVisible ? '' : 'hidden'}"
             onclick="cogToggleIso('${iso.techId}', this)">
            <div class="cog-iso-color-dot" style="background:${color};border-color:${color};"></div>
            <span class="cog-iso-name">${iso.name}</span>
            <div class="cog-iso-toggle-switch ${isVisible ? 'on' : ''}"></div>
        </div>`;
    }).join('') || '<div style="font-size:11px;color:#adb5bd;padding:8px;">Keine Isochronen geladen</div>';

    if (simIsos.length > 0) {
        simLabel.style.display = '';
        simList.innerHTML = simIsos.map(iso => {
            const layerObj = isochroneLayers.find(l => l.techId === iso.techId);
            const isVisible = layerObj ? map.hasLayer(layerObj.layer) : false;
            return `
            <div class="cog-iso-toggle-item ${isVisible ? '' : 'hidden'}"
                 onclick="cogToggleIso('${iso.techId}', this)">
                <div class="cog-iso-color-dot" style="background:#f1c40f;border-color:#e67e22;"></div>
                <span class="cog-iso-name">${iso.name}</span>
                <span class="cog-iso-candidate-badge">Kandidat</span>
                <div class="cog-iso-toggle-switch ${isVisible ? 'on' : ''}"></div>
            </div>`;
        }).join('');
    } else {
        simLabel.style.display = 'none';
        simList.innerHTML = '';
    }
}

function cogToggleIso(techId, itemEl) {
    const layerObj = isochroneLayers.find(l => l.techId === techId);
    if (!layerObj) return;
    const sw = itemEl.querySelector('.cog-iso-toggle-switch');
    if (map.hasLayer(layerObj.layer)) {
        map.removeLayer(layerObj.layer);
        sw.classList.remove('on');
        itemEl.classList.add('hidden');
    } else {
        layerObj.layer.addTo(map);
        sw.classList.add('on');
        itemEl.classList.remove('hidden');
    }
}

function cogIsoToggleAll(show) {
    isochroneLayers.forEach(layerObj => {
        if (show) { if (!map.hasLayer(layerObj.layer)) layerObj.layer.addTo(map); }
        else       { if ( map.hasLayer(layerObj.layer)) map.removeLayer(layerObj.layer); }
    });
    renderCogIsochroneToggles();
}

function cogIsoOnlySimulated() {
    isochroneLayers.forEach(layerObj => {
        const iso = isochroneGeoJSON.find(i => i.techId === layerObj.techId);
        if (iso && iso.isCandidate) {
            if (!map.hasLayer(layerObj.layer)) layerObj.layer.addTo(map);
        } else {
            if (map.hasLayer(layerObj.layer)) map.removeLayer(layerObj.layer);
        }
    });
    renderCogIsochroneToggles();
}

// ── KUNDEN-LISTE ─────────────────────────────────────────────
let cogKundenFilterState = 'all';

function setCogKundenFilter(filter, el) {
    cogKundenFilterState = filter;
    document.querySelectorAll('.cog-filter-chip').forEach(c => c.classList.remove('active'));
    el.classList.add('active');
    renderCogKunden();
}

function renderCogKunden() {
    const list = document.getElementById('cogKundenList');
    const visKunden = kunden.filter(k => k.visible !== false);

    let filtered;
    if (cogKundenFilterState === 'uncovered') {
        filtered = visKunden.filter(k => !k.covered);
    } else if (cogKundenFilterState === 'partial') {
        filtered = visKunden.filter(k => {
            const total = (k.instrumentLines || []).length;
            const cov = k.coveredDevices || 0;
            return cov > 0 && cov < total;
        });
    } else if (cogKundenFilterState === 'covered') {
        filtered = visKunden.filter(k => k.covered);
    } else {
        filtered = visKunden;
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div class="cog-empty">Keine Kunden in dieser Kategorie.</div>';
        return;
    }

    list.innerHTML = filtered.slice(0, 100).map(k => {
        const total   = (k.instrumentLines || []).filter(d => d && d.trim()).length;
        const covered = k.coveredDevices || 0;
        const pct     = total > 0 ? Math.round(covered / total * 100) : 0;
        const color   = k.covered ? '#27ae60' : (covered > 0 ? '#f39c12' : '#e74c3c');
        const devices = (k.instrumentLines || []).slice(0, 3).join(', ')
            + ((k.instrumentLines || []).length > 3 ? ` +${k.instrumentLines.length - 3}` : '');

        return `
        <div class="cog-kunden-item">
            <div class="cog-kunden-status-dot" style="background:${color};"></div>
            <div style="flex:1;min-width:0;">
                <div class="cog-kunden-name">${k.name}</div>
                <div class="cog-kunden-devices">${devices || 'keine Geräte'}</div>
                <div class="cog-kunden-coverage">${covered}/${total} Geräte (${pct}%)</div>
            </div>
        </div>`;
    }).join('');

    if (filtered.length > 100) {
        list.innerHTML += `<div class="cog-empty">... und ${filtered.length - 100} weitere</div>`;
    }
}

function switchCogTab(tab, btn) {
    document.querySelectorAll('.cog-sim-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.cog-sim-tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('cogTab' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
    if (tab === 'isochronen') renderCogIsochroneToggles();
    if (tab === 'kunden')     renderCogKunden();
}

// ── DRAG & RESIZE ────────────────────────────────────────────
function initCogSimWindow() {
    const win    = document.getElementById('cogSimWindow');
    const header = document.getElementById('cogSimHeader');
    const resize = document.getElementById('cogSimResize');

    // Drag
    let dragging = false, ox = 0, oy = 0, startX = 0, startY = 0;
    header.addEventListener('mousedown', e => {
        if (e.target.closest('button')) return;
        dragging = true;
        const rect = win.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        ox = rect.left;     oy = rect.top;
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', () => {
            dragging = false;
            document.removeEventListener('mousemove', onDrag);
        }, { once: true });
    });
    function onDrag(e) {
        if (!dragging) return;
        win.style.left   = (ox + e.clientX - startX) + 'px';
        win.style.top    = (oy + e.clientY - startY) + 'px';
        win.style.right  = 'auto';
        win.style.bottom = 'auto';
    }

    // Resize
    let resizing = false, rox = 0, roy = 0, rw = 0, rh = 0;
    resize.addEventListener('mousedown', e => {
        resizing = true;
        rox = e.clientX; roy = e.clientY;
        rw = win.offsetWidth; rh = win.offsetHeight;
        e.preventDefault();
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', () => {
            resizing = false;
            document.removeEventListener('mousemove', onResize);
        }, { once: true });
    });
    function onResize(e) {
        if (!resizing) return;
        const newW = Math.max(320, rw + e.clientX - rox);
        const newH = Math.max(300, rh + e.clientY - roy);
        win.style.width  = newW + 'px';
        win.style.height = newH + 'px';
    }
}


// ═══════════════════════════════════════════════════════════
// COG KANDIDATEN — ECHTE ISOCHRONE LADEN
// ═══════════════════════════════════════════════════════════

async function loadCandidateIsochrone(index) {
    const cand = cogCandidates[index];
    if (!cand) return;

    const btn = document.getElementById(`cog-btn-${index}`);
    const statusEl = document.getElementById(`cog-status-${index}`);
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = '⏳ Lade Isochrone…';

    // Alte Kandidaten-Isochrone dieses Index entfernen
    const candTechId = `cog_candidate_${index}`;
    const oldIsoIdx = isochroneGeoJSON.findIndex(iso => iso.techId === candTechId);
    if (oldIsoIdx !== -1) isochroneGeoJSON.splice(oldIsoIdx, 1);
    const oldLayerIdx = isochroneLayers.findIndex(l => l.techId === candTechId);
    if (oldLayerIdx !== -1) {
        map.removeLayer(isochroneLayers[oldLayerIdx].layer);
        isochroneLayers.splice(oldLayerIdx, 1);
    }

    try {
        const result = await fetchIsochrone(cand.lat, cand.lng, cand.label);
        if (!result.success) {
            if (statusEl) statusEl.textContent = `❌ Fehler: ${result.error}`;
            if (btn) btn.disabled = false;
            return;
        }

        drawCandidateIsochrone(result.data, cand.label, candTechId);
        if (statusEl) statusEl.textContent = '✅ Geladen — KI analysiert…';
        if (cogSimOpen) renderCogCandidates(), renderCogIsochroneToggles();

        await new Promise(r => setTimeout(r, 400));
        await refineCOGWithRealIsochrone(index, cand.label);

    } catch (err) {
        console.error('loadCandidateIsochrone error:', err);
        if (statusEl) statusEl.textContent = `❌ ${err.message}`;
        if (btn) btn.disabled = false;
    }
}

function drawCandidateIsochrone(isochroneData, name, techId) {
    if (!isochroneData || !isochroneData.features || isochroneData.features.length === 0) return;
    const feature = isochroneData.features[0];

    isochroneGeoJSON.push({ name, techId, feature, range: 3600, isCandidate: true });

    const layer = L.geoJSON(feature, {
        style: {
            color: '#f1c40f',
            weight: 3,
            opacity: 0.9,
            fillColor: '#f1c40f',
            fillOpacity: 0.12,
            dashArray: '8, 6'
        }
    }).bindPopup(`
        <div class="popup-title">📍 ${name}</div>
        <div class="popup-info">🎯 COG-Kandidat (Simulation)</div>
        <div class="popup-info">⏱️ 1h Fahrzeit</div>
    `);

    layer.addTo(map);
    isochroneLayers.push({ techId, layer, name, color: { border: '#f1c40f', fill: '#f1c40f' } });
}

async function refineCOGWithRealIsochrone(index, label) {
    const cogResult = computeCenterOfGravity();
    const sendBtn = document.getElementById('aiSendBtn');
    if (sendBtn) sendBtn.disabled = true;
    const loadingDiv = showAILoading();

    const systemPrompt = `Du bist ein KI-Assistent für Techniker-Einsatzplanung.

KONTEXT: Für Kandidat ${index + 1} (${label}) wurde eine ECHTE Isochrone (reale Fahrzone) geladen.
Die COG-Analyse wurde damit neu berechnet — die Daten unten sind präzise, nicht mehr geschätzt.

AUFGABE:
1. Vergleiche kurz: Hat die echte Fahrzone die Einschätzung verändert?
2. Konkrete Empfehlung für ${label}:
   • Wohnort (Stadt/Region — aus Koordinaten)
   • Benötigte Skills (nach Häufigkeit)
   • Wie viele Kunden erreichen den Ziel-Overlap?
3. Lohnt sich dieser Standort? Kurzes Fazit.

Kurz und direkt, keine Einleitungen. Deutsch.

AKTUALISIERTE COG-DATEN (mit echter Isochrone):
${cogResult}`;

    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiApiKey}` },
            body: JSON.stringify({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Echte Isochrone für ${label} geladen. Aktualisierte Einschätzung?` }
                ],
                temperature: 0.2,
                max_tokens: 600
            })
        });

        loadingDiv.remove();
        if (!response.ok) {
            const err = await response.json();
            addAIMessage(`❌ KI-Fehler: ${err.error?.message}`, 'assistant');
            return;
        }
        const data = await response.json();
        addAIMessage(`🔄 **Aktualisiert: ${label}**\n\n` + data.choices[0].message.content, 'assistant');

    } catch (err) {
        loadingDiv.remove();
        addAIMessage(`❌ Fehler: ${err.message}`, 'assistant');
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        const statusEl = document.getElementById(`cog-status-${index}`);
        if (statusEl) statusEl.textContent = '✅ Fertig';
        if (cogSimOpen) refreshCOGSim();
    }
}

function showCOGButtons() {
    if (cogCandidates.length === 0) return;
    openCogSimWindow();
    const chatHistory = document.getElementById('aiChatHistory');
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding: 6px 0 4px 0;';
    wrapper.innerHTML = `
        <div style="font-size:11px;color:#6c757d;margin-bottom:6px;">
            🎯 Echte Isochrone laden für präzise Analyse:
        </div>
        ${cogCandidates.map((c, i) => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
                <button id="cog-btn-${i}" onclick="loadCandidateIsochrone(${i})"
                    style="background:linear-gradient(135deg,#f1c40f,#e67e22);color:#fff;
                           border:none;border-radius:8px;padding:5px 12px;font-size:12px;
                           cursor:pointer;font-weight:600;white-space:nowrap;">
                    📍 Standort ${i + 1} laden
                </button>
                <span style="font-size:11px;color:#495057;">
                    Score ${c.score} | ${c.customersInRange} Kunden | ${c.atTarget} erreichen Ziel
                </span>
                <span id="cog-status-${i}" style="font-size:11px;color:#6c757d;"></span>
            </div>
        `).join('')}
    `;
    chatHistory.appendChild(wrapper);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Konversation zurücksetzen
function resetAIConversation() {
    aiConversationHistory = [];
    const chatHistory = document.getElementById('aiChatHistory');
    if (chatHistory) chatHistory.innerHTML = '';
    addAIMessage('Gespräch zurückgesetzt. Wie kann ich helfen?', 'assistant');
}

// Nachricht zum Chat hinzufügen
function addAIMessage(text, type) {
    const chatHistory = document.getElementById('aiChatHistory');
    const messageDiv = document.createElement('div');
    messageDiv.className = 'ai-message';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = type === 'user' ? 'ai-message-user' : (type === 'system' ? 'ai-message-system' : 'ai-message-assistant');
    
    // Text formatieren (Markdown-ähnlich)
    let formattedText = text
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>') // **bold**
        .replace(/\n/g, '<br>'); // Zeilenumbrüche
    
    contentDiv.innerHTML = formattedText;
    messageDiv.appendChild(contentDiv);
    chatHistory.appendChild(messageDiv);
    
    // Zum neuesten scrollen
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// Loading-Anzeige
function showAILoading() {
    const chatHistory = document.getElementById('aiChatHistory');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'ai-loading';
    loadingDiv.innerHTML = `
        <span>KI denkt nach</span>
        <div class="ai-loading-dots">
            <div class="ai-loading-dot"></div>
            <div class="ai-loading-dot"></div>
            <div class="ai-loading-dot"></div>
        </div>
    `;
    chatHistory.appendChild(loadingDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return loadingDiv;
}

// Vorgefertigte Frage senden
function askAI(question) {
    document.getElementById('aiInput').value = question;
    sendAIMessage();
}

// ========================================
// TAGESANALYSE FUNKTIONEN
// ========================================

// Analyse-Panel öffnen/schließen (Toggle)
function toggleAnalysisPanel() {
    const panel = document.getElementById('analysisPanel');
    panel.classList.toggle('active');
    
    if (panel.classList.contains('active')) {
        updateAnalysisForCurrentMode();
    }
}

// Analyse-Panel öffnen (ohne Toggle)
function openAnalysisPanel() {
    const panel = document.getElementById('analysisPanel');
    if (!panel.classList.contains('active')) {
        panel.classList.add('active');
    }
    
    // Input-Felder mit aktuellen Werten synchronisieren
    const overloadInput = document.getElementById('overloadThresholdInput');
    if (overloadInput) {
        overloadInput.value = overloadThreshold;
    }
    
    const penaltyInput = document.getElementById('penaltyWeightInput');
    if (penaltyInput) {
        penaltyInput.value = penaltyWeight;
    }
    
    updateAnalysisForCurrentMode();
}

// Analyse für aktuellen Modus aktualisieren
function updateAnalysisForCurrentMode() {
    const headerTitle = document.querySelector('#analysisPanelHeader span:first-child');
    
    if (appMode === 'strategy') {
        if (headerTitle) headerTitle.textContent = '🎯 Strategieanalyse';
        calculateStrategyAnalysis();
    } else {
        if (headerTitle) headerTitle.textContent = '📊 Tagesanalyse';
        calculateDayAnalysis();
    }
}

// Überlastungsgrenze aktualisieren
function updateOverloadThreshold() {
    const input = document.getElementById('overloadThresholdInput');
    const value = parseFloat(input.value);
    
    if (isNaN(value) || value <= 0) {
        alert('⚠️ Bitte geben Sie einen gültigen Wert größer als 0 ein.');
        input.value = overloadThreshold;
        return;
    }
    
    overloadThreshold = value;
    console.log(`⚖️ Überlastungsgrenze aktualisiert: ${overloadThreshold.toFixed(1)} GE`);
    
    // In Storage speichern
    saveToLocalStorage();
    
    // Analyse neu berechnen wenn Panel offen ist
    const panel = document.getElementById('analysisPanel');
    if (panel && panel.classList.contains('active')) {
        updateAnalysisForCurrentMode();
    }
}

// Strafgewicht aktualisieren
function updatePenaltyWeight() {
    const input = document.getElementById('penaltyWeightInput');
    const value = parseFloat(input.value);
    
    if (isNaN(value) || value < 0) {
        alert('⚠️ Bitte geben Sie einen gültigen Wert größer oder gleich 0 ein.');
        input.value = penaltyWeight;
        return;
    }
    
    penaltyWeight = value;
    console.log(`⚖️ Strafgewicht aktualisiert: ${penaltyWeight.toFixed(3)}`);
    
    // In Storage speichern
    saveToLocalStorage();
    
    // Analyse neu berechnen wenn Panel offen ist
    const panel = document.getElementById('analysisPanel');
    if (panel && panel.classList.contains('active')) {
        updateAnalysisForCurrentMode();
    }
}


// Draggable Panel initialisieren
function initDraggablePanel() {
    const panel = document.getElementById('analysisPanel');
    const header = document.getElementById('analysisPanelHeader');
    
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;
    
    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    function dragStart(e) {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        
        if (e.target === header || e.target.parentElement === header) {
            isDragging = true;
        }
    }
    
    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            xOffset = currentX;
            yOffset = currentY;
            
            setTranslate(currentX, currentY, panel);
        }
    }
    
    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        
        isDragging = false;
    }
    
    function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
    }
}

// Tagesanalyse berechnen - IDENTISCHE LOGIK wie checkCustomerCoverage()
function calculateDayAnalysis() {
    const content = document.getElementById('analysisContent');
    
    if (!selectedDate) {
        content.innerHTML = '<p style="color: #dc3545;">Kein Datum ausgewählt.</p>';
        return;
    }
    
    // WICHTIG: Nutze formatDate() wie in checkCustomerCoverage, NICHT toISOString()!
    const dateStr = formatDate(selectedDate);
    const formattedDate = formatDateGerman(selectedDate);
    
    // Prüfe ob Isochronen geladen sind
    const hasIsochrones = isochroneGeoJSON && isochroneGeoJSON.length > 0;
    
    // Sichtbare Kunden
    const visibleKunden = kunden.filter(k => k.visible !== false);
    const totalCustomers = visibleKunden.length;
    
    // Sammle alle ZR-Techniker (dieselbe Logik wie in checkCustomerCoverage)
    const zrTechniker = [];
    const zrTechnikerIds = new Set();
    
    // Prüfe ob Team-Filter aktiv ist
    const allTeams = new Set();
    techniker.forEach(tech => {
        if (tech.rsl && tech.rsl.trim()) {
            allTeams.add(tech.rsl.trim());
        }
    });
    const isTeamFilterActive = activeRSLFilters.size > 0 && activeRSLFilters.size < allTeams.size;
    
    for (const isoData of isochroneGeoJSON) {
        const techName = isoData.name;
        const tech = techniker.find(t => t.name === techName && t.active);
        
        if (!tech) continue;
        
        // Team-Filter prüfen
        if (isTeamFilterActive) {
            if (tech.rsl && tech.rsl.trim()) {
                if (!activeRSLFilters.has(tech.rsl.trim())) {
                    continue; // Techniker gehört nicht zum gefilterten Team
                }
            } else {
                continue; // Techniker ohne RSL wird ausgeblendet wenn Filter aktiv
            }
        }
        
        const techStatus = getScheduleStatus(tech.id, dateStr);
        if (techStatus === 'ZR' && !zrTechnikerIds.has(tech.id)) {
            zrTechniker.push(tech);
            zrTechnikerIds.add(tech.id);
        }
    }
    
    const zrCount = zrTechniker.length;
    
    // Alle Skills der ZR-Techniker
    const availableSkills = new Set();
    zrTechniker.forEach(tech => {
        if (tech.skills && Array.isArray(tech.skills)) {
            tech.skills.forEach(skill => availableSkills.add(skill));
        }
    });
    
    // Alle benötigten Skills (InstrumentLines) der Kunden - nur gefilterte
    const requiredSkills = new Set();
    visibleKunden.forEach(kunde => {
        if (kunde.instrumentLines && Array.isArray(kunde.instrumentLines)) {
            const filteredLines = kunde.instrumentLines.filter(line => 
                activeInstrumentLineFilters.has(line)
            );
            filteredLines.forEach(line => requiredSkills.add(line));
        }
    });
    
    // === ABDECKUNGSANALYSE: Geräte-basiert mit Gewichtung wie checkCustomerCoverage() ===
    let fullyCoveredCustomers = 0;
    let totalDevices = 0;
    let coveredDevices = 0;
    let totalWeight = 0; // Gesamtgewicht aller Geräte
    let coveredWeight = 0; // Gewicht der abgedeckten Geräte
    let partialCoveredCustomers = 0;
    
    // Techniker-Auslastung (anteilig bei Mehrfachabdeckung)
    const technicianWorkload = new Map(); // { techId: totalWeight }
    zrTechniker.forEach(tech => {
        technicianWorkload.set(tech.id, 0);
    });
    
    visibleKunden.forEach(kunde => {
        // Ensure instrumentLines is an array
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        // NUR die Geräte prüfen, die auch im Filter ausgewählt sind
        const allDevices = kunde.instrumentLines.filter(line => line && line.trim());
        const devices = allDevices.filter(line => activeInstrumentLineFilters.has(line));
        
        if (devices.length === 0) return;
        
        totalDevices += devices.length;
        let devicesCoveredForCustomer = 0;
        let weightCoveredForCustomer = 0;
        let totalWeightForCustomer = 0;
        
        // Prüfe jedes Gerät einzeln
        devices.forEach(instrumentLine => {
            const instrumentName = instrumentLine.toLowerCase();
            const deviceWeight = deviceWeights[instrumentLine] || 1.0;
            totalWeightForCustomer += deviceWeight;
            
            // Sammle ALLE Techniker die dieses Gerät abdecken können
            const coveringTechnicians = [];
            
            // Durchlaufe alle Isochronen (EXAKT wie in checkCustomerCoverage)
            for (const isoData of isochroneGeoJSON) {
                const feature = isoData.feature;
                const techName = isoData.name;
                
                // Finde Techniker (EXAKT wie in checkCustomerCoverage)
                const tech = techniker.find(t => t.name === techName && t.active);
                if (!tech) continue;
                
                // Prüfen ob Techniker sichtbar ist (respektiert alle Filter inkl. RSL)
                if (tech.visible === false) continue;
                
                // Prüfe ZR-Status (EXAKT wie in checkCustomerCoverage)
                const techStatus = getScheduleStatus(tech.id, dateStr);
                if (techStatus !== 'ZR') continue;
                
                // Skill-Check für dieses spezifische Gerät
                const skillMatch = tech.skills && tech.skills.some(skill => {
                    const skillLower = skill.toLowerCase().trim();
                    const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
                    return regex.test(instrumentName);
                });
                
                if (!skillMatch) continue;
                
                // Geo-Check (EXAKT wie in checkCustomerCoverage)
                if (isPointInPolygon(kunde.lng, kunde.lat, feature.geometry)) {
                    coveringTechnicians.push(tech.id);
                }
            }
            
            // Wenn mindestens ein Techniker das Gerät abdeckt
            if (coveringTechnicians.length > 0) {
                devicesCoveredForCustomer++;
                weightCoveredForCustomer += deviceWeight;
                
                // Gewicht anteilig auf alle abdeckenden Techniker verteilen
                const weightPerTechnician = deviceWeight / coveringTechnicians.length;
                coveringTechnicians.forEach(techId => {
                    const currentLoad = technicianWorkload.get(techId) || 0;
                    technicianWorkload.set(techId, currentLoad + weightPerTechnician);
                });
            }
        });
        
        coveredDevices += devicesCoveredForCustomer;
        totalWeight += totalWeightForCustomer;
        coveredWeight += weightCoveredForCustomer;
        
        // Kunde gilt nur als vollständig abgedeckt wenn ALLE Geräte abgedeckt sind
        if (devicesCoveredForCustomer === devices.length) {
            fullyCoveredCustomers++;
        } else if (devicesCoveredForCustomer > 0) {
            partialCoveredCustomers++;
        }
    });
    
    const deviceCoveragePercent = totalWeight > 0 ? ((coveredWeight / totalWeight) * 100).toFixed(1) : 0;
    const deviceCoveragePercentUnweighted = totalDevices > 0 ? ((coveredDevices / totalDevices) * 100).toFixed(1) : 0;
    
    // === TECHNIKER-AUSLASTUNGS-ANALYSE (für Effizienz-Score) ===
    const overloadedTechnicians = [];
    const normalTechnicians = [];
    let totalOverload = 0;
    
    zrTechniker.forEach(tech => {
        const workload = technicianWorkload.get(tech.id) || 0;
        const techInfo = {
            tech: tech,
            workload: workload,
            isOverloaded: workload > overloadThreshold
        };
        
        if (techInfo.isOverloaded) {
            overloadedTechnicians.push(techInfo);
            const excessLoad = ((workload / overloadThreshold) - 1) * 100; // Überlastung in %
            totalOverload += excessLoad;
        } else {
            normalTechnicians.push(techInfo);
        }
    });
    
    // Sortiere nach Auslastung (höchste zuerst)
    overloadedTechnicians.sort((a, b) => b.workload - a.workload);
    normalTechnicians.sort((a, b) => b.workload - a.workload);
    
    // Berechne durchschnittliche Überlastung (nur überlastete Techniker)
    const avgOverload = overloadedTechnicians.length > 0 ? totalOverload / overloadedTechnicians.length : 0;
    
    // === EFFIZIENZ-SCORE BERECHNUNG ===
    // E = C / (1 + α * O)
    const efficiencyScore = parseFloat(deviceCoveragePercent) / (1 + penaltyWeight * avgOverload);
    
    // Farbe für Effizienz-Score
    const effColor = efficiencyScore >= 80 ? '#28a745' : 
                     efficiencyScore >= 60 ? '#ffc107' : '#dc3545';
    const effTextColor = efficiencyScore >= 60 && efficiencyScore < 80 ? '#000' : '#fff';
    
    // Fehlende Skills (mit RegEx wie bei Skill-Match)
    const missingSkills = [];
    requiredSkills.forEach(requiredSkill => {
        const requiredLower = requiredSkill.toLowerCase();
        
        const hasMatchingTech = zrTechniker.some(tech => {
            return tech.skills && tech.skills.some(skill => {
                const skillLower = skill.toLowerCase().trim();
                const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
                return regex.test(requiredLower);
            });
        });
        
        if (!hasMatchingTech) {
            missingSkills.push(requiredSkill);
        }
    });
    
    // HTML aufbauen
    const activeRSLs = Array.from(activeRSLFilters);
    
    let html = `
        <!-- EFFIZIENZ-SCORE PROMINENT ANZEIGEN -->
        <div style="background: linear-gradient(135deg, ${effColor} 0%, ${effColor}dd 100%); color: ${effTextColor}; padding: 20px; border-radius: 8px; margin-bottom: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
            <h3 style="margin: 0 0 5px 0; font-size: 14px; opacity: 0.9;">⚡ Effizienz-Score</h3>
            <div style="font-size: 42px; font-weight: bold; margin: 8px 0;">
                ${efficiencyScore.toFixed(1)}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; font-size: 13px;">
                <div>
                    <div style="opacity: 0.9; font-size: 11px;">Abdeckung</div>
                    <div style="font-size: 18px; font-weight: 600;">${deviceCoveragePercent}%</div>
                </div>
                <div>
                    <div style="opacity: 0.9; font-size: 11px;">Überlastung</div>
                    <div style="font-size: 18px; font-weight: 600;">${avgOverload > 0 ? '+' : ''}${avgOverload.toFixed(1)}%</div>
                </div>
            </div>
        </div>
        
        <div style="background: #e7f3ff; border-left: 4px solid #667eea; padding: 10px; border-radius: 4px; margin-bottom: 12px;">
            <span style="color: #004085; font-size: 11px;">
                <strong>ℹ️ Formel:</strong> E = Abdeckung / (1 + ${penaltyWeight.toFixed(3)} × Überlastung)
            </span>
        </div>
        
        <div class="calendar-legend-inline" style="display: flex; gap: 8px; font-size: 9px; margin-bottom: 10px; padding: 6px 8px; background: #f8f9fa; border-radius: 6px; flex-wrap: wrap;">
            <span style="display: flex; align-items: center; gap: 3px;"><span style="background: #fd7e14; color: white; padding: 1px 4px; border-radius: 3px; font-weight: 600;">ZR</span> Bereitschaft</span>
            <span style="display: flex; align-items: center; gap: 3px;">🏢 Abgedeckt</span>
            <span style="display: flex; align-items: center; gap: 3px;">⚠️ Nicht abgedeckt</span>
        </div>
        
        <div style="background: #f8f9fa; padding: 12px; border-radius: 8px; margin-bottom: 12px;">
            <h4 style="color: #495057; margin-bottom: 8px; font-size: 15px;">📅 ${formattedDate}</h4>
            ${activeRSLs.length > 0 && activeRSLs.length < techniker.filter(t => t.rsl).length ? 
                `<p style="color: #6c757d; font-size: 12px; margin: 0;">🏢 Teamgebiet-Filter aktiv: ${activeRSLs.join(', ')}</p>` : ''}
            ${!hasIsochrones ? 
                `<p style="color: #dc3545; font-size: 12px; margin: 4px 0 0 0;">⚠️ Keine Isochronen geladen - Bitte erst "Isochronen laden" klicken</p>` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div style="background: #667eea; color: white; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 28px; font-weight: bold;">${zrCount}</div>
                <div style="font-size: 12px; opacity: 0.9;">ZR-Techniker</div>
            </div>
            
            <div style="background: ${deviceCoveragePercent >= 80 ? '#28a745' : deviceCoveragePercent >= 50 ? '#ffc107' : '#dc3545'}; color: ${deviceCoveragePercent >= 50 && deviceCoveragePercent < 80 ? '#000' : '#fff'}; padding: 15px; border-radius: 8px; text-align: center;">
                <div style="font-size: 28px; font-weight: bold;">${deviceCoveragePercent}%</div>
                <div style="font-size: 12px; opacity: 0.9;">Gewichtete Geräte-Abdeckung</div>
            </div>
        </div>
        
        <div style="background: #e7f3ff; border-left: 4px solid #667eea; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
            <h4 style="color: #004085; margin-bottom: 8px; font-size: 13px;">📊 Abdeckungs-Details</h4>
            <p style="color: #004085; margin: 4px 0; font-size: 12px;">⚖️ Gewichtete Abdeckung: <strong>${coveredWeight.toFixed(1)}</strong> von ${totalWeight.toFixed(1)} Gewichtseinheiten (${deviceCoveragePercent}%)</p>
            <p style="color: #004085; margin: 4px 0; font-size: 12px;">🔧 Geräte abgedeckt: <strong>${coveredDevices}</strong> von ${totalDevices} Geräten (${deviceCoveragePercentUnweighted}%)</p>
            <p style="color: #004085; margin: 4px 0; font-size: 12px;">✅ Vollständig abgedeckte Kunden: <strong>${fullyCoveredCustomers}</strong> von ${totalCustomers}</p>
            ${partialCoveredCustomers > 0 ? `<p style="color: #856404; margin: 4px 0; font-size: 12px;">⚠️ Teilweise abgedeckt: <strong>${partialCoveredCustomers}</strong> Kunden</p>` : ''}
            <p style="color: #004085; margin: 4px 0; font-size: 12px;">❌ Nicht abgedeckt: <strong>${totalCustomers - fullyCoveredCustomers - partialCoveredCustomers}</strong> Kunden</p>
            <p style="color: #6c757d; margin: 8px 0 0 0; font-size: 11px; font-style: italic;">
                Kunde gilt als vollständig abgedeckt wenn ALLE Geräte Skills + Reichweite haben
            </p>
        </div>
    `;
    
    // Fehlende Skills anzeigen
    if (missingSkills.length > 0) {
        html += `
            <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
                <h4 style="color: #721c24; margin-bottom: 8px; font-size: 13px;">⚠️ Fehlende Skills (${missingSkills.length})</h4>
                <div style="color: #721c24; font-size: 12px;">
        `;
        
        missingSkills.sort().forEach(skill => {
            const kundenCount = visibleKunden.filter(k => 
                k.instrumentLines && k.instrumentLines.includes(skill)
            ).length;
            html += `<span style="background: white; padding: 4px 8px; margin: 3px; border-radius: 3px; display: inline-block;">${skill} (${kundenCount})</span>`;
        });
        
        html += `
                </div>
            </div>
        `;
    } else if (requiredSkills.size > 0) {
        html += `
            <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
                <h4 style="color: #155724; margin: 0; font-size: 13px;">✅ Alle Skills durch ZR-Techniker verfügbar</h4>
            </div>
        `;
    }
    
    // Zeige überlastete Techniker prominent
    if (overloadedTechnicians.length > 0) {
        html += `
            <div style="background: #f8d7da; border-left: 4px solid #dc3545; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
                <h4 style="color: #721c24; margin-bottom: 8px; font-size: 13px;">⚠️ Überlastete Techniker (${overloadedTechnicians.length})</h4>
                <p style="color: #721c24; font-size: 11px; margin: 4px 0 8px 0;">Grenzwert: ${overloadThreshold.toFixed(1)} Gewichtseinheiten</p>
        `;
        
        overloadedTechnicians.slice(0, 5).forEach(info => {
            const overloadPercent = ((info.workload / overloadThreshold) * 100).toFixed(0);
            const rslInfo = info.tech.rsl ? ` (${info.tech.rsl})` : '';
            html += `
                <div style="background: white; padding: 8px; margin: 6px 0; border-radius: 4px; border-left: 3px solid #dc3545; font-size: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong>🔴 ${info.tech.name}</strong>${rslInfo}
                        <span style="background: #dc3545; color: white; padding: 2px 8px; border-radius: 3px; font-weight: 600;">
                            ${info.workload.toFixed(1)} GE (${overloadPercent}%)
                        </span>
                    </div>
                    <div style="background: #e9ecef; border-radius: 3px; height: 6px; margin-top: 6px; overflow: hidden;">
                        <div style="background: #dc3545; height: 100%; width: ${Math.min(overloadPercent, 200)}%;"></div>
                    </div>
                </div>
            `;
        });
        
        if (overloadedTechnicians.length > 5) {
            html += `<p style="color: #721c24; font-size: 11px; margin: 8px 0 0 0;">... und ${overloadedTechnicians.length - 5} weitere überlastete Techniker</p>`;
        }
        
        html += `</div>`;
    } else {
        html += `
            <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 12px; border-radius: 4px; margin-bottom: 12px;">
                <h4 style="color: #155724; margin: 0; font-size: 13px;">✅ Keine Überlastung erkannt (Grenzwert: ${overloadThreshold.toFixed(1)} GE)</h4>
            </div>
        `;
    }
    
    // Verfügbare ZR-Techniker auflisten (mit Auslastung)
    if (zrTechniker.length > 0) {
        html += `
            <div style="padding: 12px; background: #fff3cd; border-radius: 8px; margin-bottom: 12px;">
                <h4 style="color: #856404; margin-bottom: 8px; font-size: 13px;">👷 ZR-Techniker Auslastung (${zrTechniker.length})</h4>
        `;
        
        // Zeige erst normale, dann überlastete (damit Warnung sichtbar bleibt)
        const allTechInfo = [...normalTechnicians, ...overloadedTechnicians].slice(0, 10);
        
        allTechInfo.forEach(info => {
            const tech = info.tech;
            const workload = info.workload;
            const techSkills = tech.skills && tech.skills.length > 0 ? tech.skills.join(', ') : 'Keine Skills';
            const hasIso = isochroneGeoJSON.find(iso => iso.techId === tech.id) ? '📍' : '⚠️';
            const rslInfo = tech.rsl ? ` (${tech.rsl})` : '';
            
            let statusColor = '#28a745'; // Grün
            let statusIcon = '🟢';
            if (workload > overloadThreshold) {
                statusColor = '#dc3545'; // Rot
                statusIcon = '🔴';
            } else if (workload > overloadThreshold * 0.7) {
                statusColor = '#ffc107'; // Gelb
                statusIcon = '🟡';
            }
            
            html += `
                <div style="background: white; padding: 8px; margin: 6px 0; border-radius: 4px; border-left: 3px solid ${statusColor}; font-size: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong>${statusIcon} ${hasIso} ${tech.name}</strong>${rslInfo}
                        <span style="background: ${statusColor}; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: 600;">
                            ${workload.toFixed(1)} GE
                        </span>
                    </div>
                    <small style="color: #6c757d;">Skills: ${techSkills}</small>
                </div>
            `;
        });
        
        if (zrTechniker.length > 10) {
            html += `<p style="color: #856404; font-size: 11px; margin: 8px 0 0 0;">... und ${zrTechniker.length - 10} weitere</p>`;
        }
        
        html += `</div>`;
    } else {
        html += `
            <div style="padding: 12px; background: #f8d7da; border-radius: 8px;">
                <p style="color: #721c24; margin: 0; font-size: 12px;">
                    <strong>⚠️</strong> Keine Techniker mit Status "ZR" und Isochrone verfügbar.
                </p>
            </div>
        `;
    }
    
    content.innerHTML = html;
}

// Datum im deutschen Format formatieren
function formatDateGerman(date) {
    const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    
    const dayName = days[date.getDay()];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return `${dayName}, ${day}. ${month} ${year}`;
}

// ===== STRATEGIEMODUS =====

// App-Modus umschalten (Kalender / Strategie / Zukunft)
function setAppMode(mode) {
    if (appMode === mode) return;

    const previousMode = appMode;
    appMode = mode;

    console.log(`🔄 Modus gewechselt zu: ${appMode}`);

    // Labels aktualisieren
    document.getElementById('modeLabelCalendar').classList.toggle('active', appMode === 'calendar');
    document.getElementById('modeLabelStrategy').classList.toggle('active', appMode === 'strategy');
    document.getElementById('modeLabelFuture').classList.toggle('active', appMode === 'future');

    // Body-Klasse für Header-Farbe
    document.body.classList.toggle('strategy-mode-active', appMode === 'strategy');
    document.body.classList.toggle('future-mode-active', appMode === 'future');

    // Sidebar-Klassen
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('strategy-mode', appMode === 'strategy');

    // Analyse-Panel Klassen
    const analysisPanel = document.getElementById('analysisPanel');
    analysisPanel.classList.toggle('strategy-mode', appMode === 'strategy');

    // Notizen-Fenster Klassen
    const notesWindow = document.getElementById('notesWindow');
    notesWindow.classList.toggle('strategy-mode', appMode === 'strategy');

    // Vorherigen Modus verlassen
    if (previousMode === 'strategy') {
        exitStrategyMode();
    } else if (previousMode === 'future') {
        exitFutureMode();
    }

    // Neuen Modus betreten
    if (appMode === 'strategy') {
        enterStrategyMode();
    } else if (appMode === 'future') {
        enterFutureMode();
    }
}

// Strategiemodus aktivieren
function enterStrategyMode() {
    console.log('🎯 Strategiemodus aktiviert');
    
    // Assignment-Button anzeigen
    const assignmentBtn = document.getElementById('assignmentModeBtn');
    if (assignmentBtn) {
        assignmentBtn.style.display = 'block';
    }
    
    // Kalender zuklappen
    const scheduleSection = document.getElementById('scheduleSection');
    if (scheduleSection && !scheduleSection.classList.contains('collapsed')) {
        scheduleSection.classList.add('collapsed');
        const toggle = document.getElementById('scheduleToggle');
        if (toggle) toggle.classList.add('collapsed');
    }
    
    // Alle Techniker auf Karte anzeigen (unabhängig von ZR) - ZUERST!
    updateMapForStrategyMode();
    
    // Automatische Analyse durchführen (ohne Alert) - DANACH!
    performAnalysisSilent();
    
    // Analyse-Panel öffnen mit Strategie-Analyse
    openAnalysisPanel();
}

// Strategiemodus verlassen
function exitStrategyMode() {
    console.log('📅 Kalendermodus aktiviert');
    
    // Assignment-Button verstecken und Assignment-Modus deaktivieren
    const assignmentBtn = document.getElementById('assignmentModeBtn');
    if (assignmentBtn) {
        assignmentBtn.style.display = 'none';
    }
    
    // Falls Assignment-Modus aktiv war, diesen deaktivieren
    if (assignmentMode) {
        toggleAssignmentMode();
    }
    
    // Kalender ausklappen
    const scheduleSection = document.getElementById('scheduleSection');
    if (scheduleSection && scheduleSection.classList.contains('collapsed')) {
        scheduleSection.classList.remove('collapsed');
        const toggle = document.getElementById('scheduleToggle');
        if (toggle) toggle.classList.remove('collapsed');
    }
    
    // Automatische Analyse durchführen (ohne Alert)
    performAnalysisSilent();
    
    // Karte für ausgewählten Tag aktualisieren
    updateMapForSelectedDate();
    
    // Analyse neu berechnen
    const analysisPanel = document.getElementById('analysisPanel');
    if (analysisPanel && analysisPanel.classList.contains('active')) {
        updateAnalysisForCurrentMode();
    }
}

// Karte für Strategiemodus aktualisieren (alle Techniker)
function updateMapForStrategyMode() {
    console.log('🗺️ Aktualisiere Karte für Strategiemodus');
    
    // Alle Techniker sichtbar machen (respektiere Filter)
    techniker.forEach(tech => {
        // Prüfe RSL-Filter
        if (activeRSLFilters.size > 0 && tech.rsl) {
            tech.visible = activeRSLFilters.has(tech.rsl);
        } else if (activeRSLFilters.size > 0) {
            tech.visible = false;
        } else {
            tech.visible = true;
        }
    });
    
    updateAllMarkers();
    
    // Alle Isochronen für sichtbare Techniker anzeigen
    if (isochroneGeoJSON.length > 0) {
        // Isochronen-Layer aktualisieren
        isochroneLayers.forEach(layerInfo => {
            const tech = techniker.find(t => t.id === layerInfo.techId);
            if (tech && tech.visible) {
                if (!map.hasLayer(layerInfo.layer)) {
                    map.addLayer(layerInfo.layer);
                }
            } else {
                if (map.hasLayer(layerInfo.layer)) {
                    map.removeLayer(layerInfo.layer);
                }
            }
        });
    }
    
    // Kundenabdeckung neu berechnen (alle Techniker, kein ZR-Check)
    checkCustomerCoverageStrategy();
}

// ===== ZUKUNFTSMODUS (Simulations-Sandbox) =====
// Techniker, Kunden und Systeme lassen sich hier frei hinzufügen/löschen,
// um Was-wäre-wenn-Szenarien zu testen, ohne die echten Daten zu verändern.

// Zukunftsmodus aktivieren
function enterFutureMode() {
    console.log('🔮 Zukunftsmodus aktiviert');

    // Kalender zuklappen (wie im Strategiemodus)
    const scheduleSection = document.getElementById('scheduleSection');
    if (scheduleSection && !scheduleSection.classList.contains('collapsed')) {
        scheduleSection.classList.add('collapsed');
        const toggle = document.getElementById('scheduleToggle');
        if (toggle) toggle.classList.add('collapsed');
    }

    // Echte Marker & Isochronen von der Karte ausblenden (Daten bleiben unverändert)
    hideRealMapLayers();

    // Sandbox beim allerersten Betreten mit einer Kopie der echten Daten befüllen
    if (futureTechniker.length === 0 && futureKunden.length === 0 && futureScenarioId === null) {
        initFutureSandboxFromReal();
    }

    futureRealCoveragePercent = computeCurrentRealCoveragePercent();

    renderFutureMarkers();
    checkCustomerCoverageFuture();
    renderFutureMarkers(); // Icons (✅/⚠️) nach Coverage-Berechnung neu zeichnen
    renderFutureSandboxPanel();
    refreshFutureScenarioSelect();
}

// Zukunftsmodus verlassen
function exitFutureMode() {
    console.log('🔮 Zukunftsmodus verlassen');

    // Sandbox-Layer von der Karte entfernen (Daten bleiben im Speicher erhalten)
    clearFutureMapLayers();
}

// Blendet die echten Techniker-/Kunden-Marker und Isochronen von der Karte aus,
// ohne die zugrundeliegenden Arrays zu verändern.
function hideRealMapLayers() {
    technikerMarkers.forEach(item => {
        if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
    });
    kundenMarkers.forEach(item => {
        if (map.hasLayer(item.marker)) map.removeLayer(item.marker);
    });
    isochroneLayers.forEach(item => {
        if (map.hasLayer(item.layer)) map.removeLayer(item.layer);
    });
}

// Entfernt alle Sandbox-Layer von der Karte (Daten in future*-Arrays bleiben erhalten)
function clearFutureMapLayers() {
    futureTechnikerMarkers.forEach(item => map.removeLayer(item.marker));
    futureTechnikerMarkers = [];
    futureKundenMarkers.forEach(item => map.removeLayer(item.marker));
    futureKundenMarkers = [];
    futureIsochroneLayers.forEach(item => map.removeLayer(item.layer));
    futureIsochroneLayers = [];
}

// Sandbox mit einer tiefen Kopie der echten Techniker/Kunden befüllen
function initFutureSandboxFromReal() {
    futureTechniker = techniker.map(t => {
        const clone = structuredClone(t);
        clone.isSimulated = false;
        return clone;
    });

    futureKunden = kunden.map(k => {
        const clone = structuredClone(k);
        clone.isSimulated = false;
        return clone;
    });

    // Bereits gecachte Isochronen der echten Techniker übernehmen (kein erneuter API-Aufruf nötig)
    futureIsochroneGeoJSON = isochroneGeoJSON
        .filter(iso => techniker.some(t => t.id === iso.techId))
        .map(iso => {
            const clone = structuredClone(iso);
            clone.isSimulated = false;
            return clone;
        });

    futureScenarioId = null;
    futureScenarioName = null;
}

// Aktuelle echte Abdeckung (%) für den KPI-Vergleich in der Sandbox
function computeCurrentRealCoveragePercent() {
    const relevant = kunden.filter(k =>
        k.visible !== false &&
        Array.isArray(k.instrumentLines) &&
        k.instrumentLines.filter(l => l && l.trim()).length > 0
    );
    if (relevant.length === 0) return null;
    const covered = relevant.filter(k => k.covered).length;
    return Math.round((covered / relevant.length) * 100);
}

// Prüft, ob ein Gerätename zu einer Skill-Liste passt (Wortgrenzen-Regex)
function deviceMatchesSkills(deviceName, skills) {
    if (!skills || skills.length === 0 || !deviceName) return false;
    const nameLower = deviceName.toLowerCase();
    return skills.some(skill => {
        const skillLower = skill.toLowerCase().trim();
        if (!skillLower) return false;
        const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
        return regex.test(nameLower);
    });
}

// Kundenabdeckung innerhalb der Sandbox berechnen (unabhängig von echten Daten/Filtern)
function checkCustomerCoverageFuture() {
    const visibleTechIds = new Set(
        futureTechniker.filter(t => t.visible !== false).map(t => t.id)
    );

    futureKunden.forEach(kunde => {
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }

        const devices = kunde.instrumentLines.filter(line => line && line.trim());
        kunde.totalDevices = devices.length;
        kunde.coveredDevicesList = [];

        if (kunde.visible === false || devices.length === 0) {
            kunde.covered = false;
            kunde.coveredDevices = 0;
            return;
        }

        devices.forEach(instrumentLine => {
            for (const isoData of futureIsochroneGeoJSON) {
                if (!visibleTechIds.has(isoData.techId)) continue;

                const tech = futureTechniker.find(t => t.id === isoData.techId);
                if (!tech) continue;

                if (!deviceMatchesSkills(instrumentLine, tech.skills)) continue;

                if (isPointInPolygon(kunde.lng, kunde.lat, isoData.feature.geometry)) {
                    kunde.coveredDevicesList.push(instrumentLine);
                    break;
                }
            }
        });

        kunde.coveredDevices = kunde.coveredDevicesList.length;
        kunde.covered = kunde.coveredDevices === kunde.totalDevices;
    });
}

// Isochrone eines Sandbox-Technikers zeichnen (gestrichelt/gold = simuliert, durchgezogen/blau = echt kopiert)
function drawFutureIsochrone(isochroneData, name, techId, isSimulated) {
    if (!isochroneData || !isochroneData.features || isochroneData.features.length === 0) {
        console.warn(`⚠️ Keine Isochronen-Features für ${name} (Sandbox)`);
        return;
    }

    const feature = isochroneData.features[0];
    futureIsochroneGeoJSON.push({ name, techId, feature, range: 3600, isSimulated: !!isSimulated });

    const style = isSimulated
        ? { color: '#f1c40f', weight: 3, opacity: 0.9, fillColor: '#f1c40f', fillOpacity: 0.12, dashArray: '8, 6' }
        : { color: '#8e44ad', weight: 2, opacity: 0.7, fillColor: '#8e44ad', fillOpacity: 0.08 };

    const layer = L.geoJSON(feature, { style }).bindPopup(`
        <div class="popup-title">${isSimulated ? '🔮 Simuliert: ' : ''}${name}</div>
        <div class="popup-info">⏱️ Einzugsgebiet (Sandbox)</div>
    `);

    layer.addTo(map);
    futureIsochroneLayers.push({ techId, layer, name });
}

// Techniker in der Sandbox anlegen (aus dem bestehenden Techniker-Modal)
function addSimTechniker() {
    const name = document.getElementById('techName').value.trim();
    const lat = parseFloat(document.getElementById('techLat').value);
    const lng = parseFloat(document.getElementById('techLng').value);
    const skillsInput = document.getElementById('techSkills').value.trim();
    const rsl = document.getElementById('techRSL').value.trim();

    if (!name || isNaN(lat) || isNaN(lng)) {
        alert('Bitte alle Felder korrekt ausfüllen!');
        return;
    }

    const skills = skillsInput
        ? skillsInput.split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];

    const newTech = {
        id: 'sim_tech_' + Date.now(),
        name: name,
        lat: lat,
        lng: lng,
        active: true,
        skills: skills,
        rsl: rsl,
        visible: true,
        isSimulated: true
    };

    futureTechniker.push(newTech);
    closeAllModals();
    map.setView([lat, lng], 10);
    renderFutureMarkers();
    renderFutureSandboxPanel();

    fetchIsochrone(lat, lng, name).then(result => {
        if (result.success) {
            drawFutureIsochrone(result.data, name, newTech.id, true);
        } else {
            console.warn(`⚠️ Isochrone für simulierten Techniker ${name} fehlgeschlagen:`, result.error);
        }
        checkCustomerCoverageFuture();
        renderFutureMarkers();
        renderFutureSandboxPanel();
    });
}

// Kunde in der Sandbox anlegen (aus dem bestehenden Kunden-Modal)
function addSimKunde() {
    const name = document.getElementById('kundeName').value.trim();
    const instrumentLine = document.getElementById('kundeInstrumentLine').value.trim();
    const fieldServiceManager = document.getElementById('kundeFieldServiceManager').value.trim();
    const lat = parseFloat(document.getElementById('kundeLat').value);
    const lng = parseFloat(document.getElementById('kundeLng').value);

    if (!name || isNaN(lat) || isNaN(lng)) {
        alert('Bitte alle Felder korrekt ausfüllen!');
        return;
    }

    const newKunde = {
        id: 'sim_kunde_' + Date.now(),
        name: name,
        instrumentLines: instrumentLine ? [instrumentLine] : [],
        fieldServiceManager: fieldServiceManager,
        lat: lat,
        lng: lng,
        covered: false,
        visible: true,
        deviceAssignments: {},
        isSimulated: true
    };

    futureKunden.push(newKunde);
    closeAllModals();
    map.setView([lat, lng], 10);

    checkCustomerCoverageFuture();
    renderFutureMarkers();
    renderFutureSandboxPanel();
}

// Techniker aus der Sandbox entfernen (egal ob echt kopiert oder simuliert)
function deleteSimTechniker(id) {
    if (!confirm('Diesen Techniker aus der Sandbox entfernen?')) return;

    futureTechniker = futureTechniker.filter(t => t.id !== id);
    futureIsochroneGeoJSON = futureIsochroneGeoJSON.filter(iso => iso.techId !== id);

    const layerEntry = futureIsochroneLayers.find(l => l.techId === id);
    if (layerEntry) {
        map.removeLayer(layerEntry.layer);
        futureIsochroneLayers = futureIsochroneLayers.filter(l => l.techId !== id);
    }

    checkCustomerCoverageFuture();
    renderFutureMarkers();
    renderFutureSandboxPanel();
}

// Kunde aus der Sandbox entfernen (egal ob echt kopiert oder simuliert)
function deleteSimKunde(id) {
    if (!confirm('Diesen Kunden aus der Sandbox entfernen?')) return;

    futureKunden = futureKunden.filter(k => k.id !== id);
    renderFutureMarkers();
    renderFutureSandboxPanel();
}

// System/Gerät zu einem Sandbox-Kunden hinzufügen
function addSimSystemToKunde(kundeId) {
    const kunde = futureKunden.find(k => k.id === kundeId);
    if (!kunde) return;

    const name = prompt('Name des Systems/Geräts (z.B. LC, GCMS, ICPMS):');
    if (!name || !name.trim()) return;

    if (!Array.isArray(kunde.instrumentLines)) kunde.instrumentLines = [];
    kunde.instrumentLines.push(name.trim());

    checkCustomerCoverageFuture();
    renderFutureMarkers();
    renderFutureSandboxPanel();
}

// System/Gerät von einem Sandbox-Kunden entfernen
function removeSimSystemFromKunde(kundeId, systemIndex) {
    const kunde = futureKunden.find(k => k.id === kundeId);
    if (!kunde || !Array.isArray(kunde.instrumentLines)) return;

    kunde.instrumentLines.splice(systemIndex, 1);

    checkCustomerCoverageFuture();
    renderFutureMarkers();
    renderFutureSandboxPanel();
}

// Kartenmarker der Sandbox (Techniker + Kunden) neu zeichnen
function renderFutureMarkers() {
    futureTechnikerMarkers.forEach(item => map.removeLayer(item.marker));
    futureTechnikerMarkers = [];
    futureKundenMarkers.forEach(item => map.removeLayer(item.marker));
    futureKundenMarkers = [];

    futureTechniker.forEach(tech => {
        if (tech.visible === false) return;

        const badge = tech.isSimulated ? '🔮' : 'T';
        const bg = tech.isSimulated
            ? 'linear-gradient(90deg, #f39c12, #f1c40f)'
            : 'linear-gradient(90deg, #8e44ad, #9b59b6)';
        const border = tech.isSimulated ? '2px dashed white' : 'none';

        const icon = L.divIcon({
            html: `<div style="background:${bg}; color:white; padding:4px 8px; border-radius:50%; font-weight:bold; font-size:13px; width:28px; height:28px; display:flex; align-items:center; justify-content:center; box-shadow:0 2px 4px rgba(0,0,0,0.3); border:${border};">${badge}</div>`,
            className: 'custom-marker',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        const marker = L.marker([tech.lat, tech.lng], { icon: icon })
            .bindPopup(`
                <div class="popup-title">${tech.isSimulated ? '🔮 Simuliert: ' : ''}${tech.name}</div>
                <div class="popup-info">🎯 ${(tech.skills || []).join(', ') || 'Keine Skills'}</div>
            `)
            .addTo(map);

        futureTechnikerMarkers.push({ id: tech.id, marker: marker });
    });

    futureKunden.forEach(kunde => {
        if (kunde.visible === false) return;

        const hasDevices = (kunde.totalDevices || 0) > 0;
        const emoji = !hasDevices ? '📍' : (kunde.covered ? '🏢' : '⚠️');
        const glow = kunde.isSimulated ? 'filter: drop-shadow(0 0 3px #f1c40f);' : '';

        const icon = L.divIcon({
            html: `<div style="font-size:22px; ${glow}">${emoji}</div>`,
            className: 'custom-marker',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });

        const marker = L.marker([kunde.lat, kunde.lng], { icon: icon })
            .bindPopup(`
                <div class="popup-title">${kunde.isSimulated ? '🔮 Simuliert: ' : ''}${kunde.name}</div>
                <div class="popup-info">${kunde.coveredDevices || 0}/${kunde.totalDevices || 0} Geräte abgedeckt</div>
            `)
            .addTo(map);

        futureKundenMarkers.push({ id: kunde.id, marker: marker });
    });
}

// Sandbox-Panel in der Sidebar aktualisieren (KPIs + Listen)
function renderFutureSandboxPanel() {
    const kpiTech = document.getElementById('futureKpiTech');
    if (!kpiTech) return; // Panel nicht im DOM (sollte nicht vorkommen)

    kpiTech.textContent = futureTechniker.length;
    document.getElementById('futureKpiKunden').textContent = futureKunden.length;

    const relevantKunden = futureKunden.filter(k => k.visible !== false && (k.totalDevices || 0) > 0);
    const coveragePct = relevantKunden.length > 0
        ? Math.round((relevantKunden.filter(k => k.covered).length / relevantKunden.length) * 100)
        : null;
    document.getElementById('futureKpiAbdeckung').textContent = coveragePct !== null ? coveragePct + '%' : '—';
    document.getElementById('futureKpiAbdeckungReal').textContent = futureRealCoveragePercent !== null ? futureRealCoveragePercent + '%' : '—';

    // Techniker-Liste
    const techList = document.getElementById('futureTechnikerList');
    techList.innerHTML = '';
    futureTechniker.forEach(tech => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <div class="list-item-info">
                <div class="list-item-name">${tech.isSimulated ? '🔮 ' : ''}${tech.name}</div>
                <div style="font-size: 11px; color: #8e44ad;">🎯 ${(tech.skills || []).join(', ') || '—'}</div>
                <div class="list-item-coords">${tech.lat.toFixed(4)}, ${tech.lng.toFixed(4)}</div>
            </div>
            <div class="list-item-actions">
                <button class="btn-zoom" onclick="zoomToLocation(${tech.lat}, ${tech.lng})">🎯</button>
                <button class="btn-delete" onclick="deleteSimTechniker('${tech.id}')">🗑️</button>
            </div>
        `;
        techList.appendChild(item);
    });

    // Kunden-Liste (inkl. Systeme/Geräte-Chips)
    const kundenList = document.getElementById('futureKundenList');
    kundenList.innerHTML = '';
    futureKunden.forEach(kunde => {
        const devices = Array.isArray(kunde.instrumentLines) ? kunde.instrumentLines : [];
        const coveredList = kunde.coveredDevicesList || [];
        const chips = devices.map((d, idx) => {
            const covered = coveredList.includes(d);
            return `<span class="future-system-chip ${covered ? '' : 'uncovered'}">${d} <span onclick="removeSimSystemFromKunde('${kunde.id}', ${idx})" title="System entfernen">×</span></span>`;
        }).join('');

        const statusIcon = devices.length === 0 ? '' : (kunde.covered ? ' ✅' : ' ⚠️');

        const item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML = `
            <div class="list-item-info">
                <div class="list-item-name">${kunde.isSimulated ? '🔮 ' : ''}${kunde.name}${statusIcon}</div>
                <div class="list-item-coords">${kunde.lat.toFixed(4)}, ${kunde.lng.toFixed(4)}</div>
                <div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;">
                    ${chips}
                    <button class="future-system-add-btn" onclick="addSimSystemToKunde('${kunde.id}')">+ System</button>
                </div>
            </div>
            <div class="list-item-actions">
                <button class="btn-zoom" onclick="zoomToLocation(${kunde.lat}, ${kunde.lng})">🎯</button>
                <button class="btn-delete" onclick="deleteSimKunde('${kunde.id}')">🗑️</button>
            </div>
        `;
        kundenList.appendChild(item);
    });
}

// Sandbox auf den aktuellen echten Datenstand zurücksetzen
function resetFutureSandbox() {
    if (!confirm('Sandbox auf den aktuellen echten Datenstand zurücksetzen? Alle nicht gespeicherten Änderungen gehen verloren.')) return;

    clearFutureMapLayers();
    futureTechniker = [];
    futureKunden = [];
    futureIsochroneGeoJSON = [];
    futureScenarioId = null;
    futureScenarioName = null;

    initFutureSandboxFromReal();
    futureRealCoveragePercent = computeCurrentRealCoveragePercent();

    checkCustomerCoverageFuture();
    renderFutureMarkers();
    renderFutureSandboxPanel();
    refreshFutureScenarioSelect();
}

// ----- Benannte Szenarien (Persistenz in IndexedDB) -----

// Aktuellen Sandbox-Stand als benanntes Szenario speichern
function saveFutureScenario(name) {
    if (!db) {
        alert('Datenbank ist noch nicht bereit. Bitte kurz warten und erneut versuchen.');
        return;
    }

    const id = futureScenarioId || ('future_scenario_' + Date.now());
    const record = {
        id: id,
        name: name,
        createdAt: new Date().toISOString(),
        futureTechniker: futureTechniker,
        futureKunden: futureKunden,
        futureIsochroneGeoJSON: futureIsochroneGeoJSON
    };

    const tx = db.transaction([STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).put(record);

    tx.oncomplete = () => {
        futureScenarioId = id;
        futureScenarioName = name;
        updateFutureScenarioIndex(id, name);
    };
    tx.onerror = (event) => {
        console.error('❌ Fehler beim Speichern des Szenarios:', event.target.error);
        alert('Szenario konnte nicht gespeichert werden.');
    };
}

// Manifest-Eintrag (Name/ID-Liste aller Szenarien) aktualisieren
function updateFutureScenarioIndex(id, name) {
    if (!db) return;

    const tx = db.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(FUTURE_SCENARIO_INDEX_ID);

    req.onsuccess = () => {
        const idx = req.result || { id: FUTURE_SCENARIO_INDEX_ID, scenarios: [] };
        const existing = idx.scenarios.find(s => s.id === id);
        if (existing) {
            existing.name = name;
        } else {
            idx.scenarios.push({ id: id, name: name, createdAt: new Date().toISOString() });
        }
        store.put(idx);
        tx.oncomplete = () => refreshFutureScenarioSelect();
    };
}

// Liste aller gespeicherten Szenarien laden
function listFutureScenarios() {
    return new Promise((resolve) => {
        if (!db) { resolve([]); return; }

        const tx = db.transaction([STORE_NAME], 'readonly');
        const req = tx.objectStore(STORE_NAME).get(FUTURE_SCENARIO_INDEX_ID);

        req.onsuccess = () => resolve(req.result ? req.result.scenarios : []);
        req.onerror = () => resolve([]);
    });
}

// Ein gespeichertes Szenario laden (ersetzt den aktuellen Sandbox-Stand)
function loadFutureScenario(id) {
    if (!db) return;

    const tx = db.transaction([STORE_NAME], 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);

    req.onsuccess = () => {
        const record = req.result;
        if (!record) {
            alert('Szenario nicht gefunden.');
            return;
        }

        clearFutureMapLayers();
        futureTechniker = record.futureTechniker || [];
        futureKunden = record.futureKunden || [];
        futureIsochroneGeoJSON = record.futureIsochroneGeoJSON || [];
        futureScenarioId = record.id;
        futureScenarioName = record.name;

        checkCustomerCoverageFuture();
        renderFutureMarkers();
        renderFutureSandboxPanel();
        refreshFutureScenarioSelect();
    };
}

// Ein gespeichertes Szenario endgültig löschen
function deleteFutureScenario(id) {
    if (!id || !db) return;
    if (!confirm('Dieses Szenario endgültig löschen?')) return;

    const tx = db.transaction([STORE_NAME], 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);

    tx.oncomplete = () => {
        const tx2 = db.transaction([STORE_NAME], 'readwrite');
        const store2 = tx2.objectStore(STORE_NAME);
        const req2 = store2.get(FUTURE_SCENARIO_INDEX_ID);

        req2.onsuccess = () => {
            const idx = req2.result;
            if (idx) {
                idx.scenarios = idx.scenarios.filter(s => s.id !== id);
                store2.put(idx);
            }
            tx2.oncomplete = () => {
                if (futureScenarioId === id) {
                    futureScenarioId = null;
                    futureScenarioName = null;
                }
                refreshFutureScenarioSelect();
            };
        };
    };
}

// UI-Hilfsfunktionen für die Szenario-Leiste
function promptSaveFutureScenario() {
    const defaultName = futureScenarioName || ('Szenario ' + new Date().toLocaleString('de-DE'));
    const name = prompt('Name für dieses Szenario:', defaultName);
    if (!name || !name.trim()) return;
    saveFutureScenario(name.trim());
}

function deleteCurrentFutureScenario() {
    if (!futureScenarioId) {
        alert('Kein gespeichertes Szenario ausgewählt (unbenannter Entwurf kann nicht gelöscht werden).');
        return;
    }
    deleteFutureScenario(futureScenarioId);
}

function onFutureScenarioSelectChange() {
    const select = document.getElementById('futureScenarioSelect');
    const id = select.value;

    if (!id) {
        resetFutureSandbox();
        return;
    }

    if (confirm('Aktuellen Sandbox-Stand verwerfen und dieses Szenario laden?')) {
        loadFutureScenario(id);
    } else {
        select.value = futureScenarioId || '';
    }
}

async function refreshFutureScenarioSelect() {
    const select = document.getElementById('futureScenarioSelect');
    if (!select) return;

    const scenarios = await listFutureScenarios();
    select.innerHTML = '<option value="">— Unbenannter Entwurf —</option>' +
        scenarios.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
    select.value = futureScenarioId || '';
}

// Kundenabdeckung im Strategiemodus (ohne ZR-Prüfung)
function checkCustomerCoverageStrategy() {
    if (isochroneGeoJSON.length === 0) {
        return;
    }
    
    // Sichtbare Techniker ermitteln (nur Sichtbarkeit, KEIN active-Check im Strategiemodus)
    const visibleTechIds = new Set(
        techniker.filter(t => t.visible !== false).map(t => t.id)
    );
    
    let fullyCoveredCustomers = 0;
    let totalDevices = 0;
    let coveredDevices = 0;
    
    kunden.forEach(kunde => {
        // Nur sichtbare Kunden prüfen
        if (kunde.visible === false) {
            kunde.covered = false;
            kunde.coveredDevices = 0;
            kunde.totalDevices = 0;
            return;
        }
        
        if (!Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
        }
        
        // Geräte-basierte Coverage-Analyse
        // NUR die Geräte prüfen, die auch im Filter ausgewählt sind
        const allDevices = kunde.instrumentLines.filter(line => line && line.trim());
        const devices = allDevices.filter(line => activeInstrumentLineFilters.has(line));
        
        if (devices.length === 0) {
            kunde.covered = false;
            kunde.coveredDevices = 0;
            kunde.totalDevices = 0;
            return;
        }
        
        totalDevices += devices.length;
        kunde.totalDevices = devices.length;
        kunde.coveredDevicesList = [];
        
        // Prüfe jedes Gerät einzeln
        devices.forEach(instrumentLine => {
            const instrumentName = instrumentLine.toLowerCase();
            let deviceCovered = false;
            
            for (const isoData of isochroneGeoJSON) {
                const feature = isoData.feature;
                const techId = isoData.techId;
                
                // Nur sichtbare Techniker berücksichtigen
                if (!visibleTechIds.has(techId)) continue;
                
                const tech = techniker.find(t => t.id === techId);
                if (!tech) continue;
                
                // Skill-Check für dieses spezifische Gerät
                const skillMatch = tech.skills && tech.skills.some(skill => {
                    const skillLower = skill.toLowerCase().trim();
                    const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
                    return regex.test(instrumentName);
                });
                
                if (!skillMatch) continue;
                
                // Geo-Check
                if (isPointInPolygon(kunde.lng, kunde.lat, feature.geometry)) {
                    deviceCovered = true;
                    kunde.coveredDevicesList.push(instrumentLine);
                    break;
                }
            }
        });
        
        kunde.coveredDevices = kunde.coveredDevicesList.length;
        coveredDevices += kunde.coveredDevices;
        
        // Kunde gilt nur als vollständig abgedeckt wenn ALLE Geräte abgedeckt sind
        kunde.covered = kunde.coveredDevices === kunde.totalDevices;
        
        if (kunde.covered) {
            fullyCoveredCustomers++;
        }
    });
    
    updateUI();
}

// Strategieanalyse berechnen
function calculateStrategyAnalysis() {
    const content = document.getElementById('analysisContent');
    
    if (isochroneGeoJSON.length === 0) {
        content.innerHTML = `
            <div style="padding: 20px; text-align: center;">
                <p style="color: #dc3545; font-size: 14px;">⚠️ Keine Isochronen geladen</p>
                <p style="color: #6c757d; font-size: 12px; margin-top: 10px;">
                    Bitte erst "Isochronen laden" im Analyse-Bereich klicken.
                </p>
            </div>
        `;
        return;
    }
    
    // Sichtbare Techniker und Kunden (im Strategiemodus: nur Sichtbarkeit, KEIN active-Check)
    const visibleTechniker = techniker.filter(t => t.visible !== false);
    const visibleKunden = kunden.filter(k => k.visible !== false);
    
    // Analysiere pro Techniker
    const techAnalysis = [];
    
    visibleTechniker.forEach(tech => {
        // Finde Isochrone des Technikers
        const techIsochrone = isochroneGeoJSON.find(iso => iso.techId === tech.id);
        if (!techIsochrone) return;
        
        // Finde erreichbare Kunden
        const reachableCustomers = visibleKunden.filter(kunde => {
            return isPointInPolygon(kunde.lng, kunde.lat, techIsochrone.feature.geometry);
        });
        
        if (reachableCustomers.length === 0) return;
        
        // Finde fehlende Skills
        const missingSkills = new Map(); // skill -> [kunden]
        
        reachableCustomers.forEach(kunde => {
            if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) return;
            
            // NUR die Geräte prüfen, die auch im Filter ausgewählt sind
            const filteredLines = kunde.instrumentLines.filter(line => 
                line && line.trim() && activeInstrumentLineFilters.has(line)
            );
            
            filteredLines.forEach(instrumentLine => {
                
                const instrumentName = instrumentLine.toLowerCase();
                
                // Prüfe ob Techniker diesen Skill hat
                const hasSkill = tech.skills && tech.skills.some(skill => {
                    const skillLower = skill.toLowerCase().trim();
                    const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
                    return regex.test(instrumentName);
                });
                
                if (!hasSkill) {
                    if (!missingSkills.has(instrumentLine)) {
                        missingSkills.set(instrumentLine, []);
                    }
                    if (!missingSkills.get(instrumentLine).find(k => k.id === kunde.id)) {
                        missingSkills.get(instrumentLine).push(kunde);
                    }
                }
            });
        });
        
        techAnalysis.push({
            tech: tech,
            reachableCount: reachableCustomers.length,
            missingSkills: missingSkills,
            missingCount: missingSkills.size
        });
    });
    
    // Sortiere: Techniker mit fehlenden Skills zuerst
    techAnalysis.sort((a, b) => b.missingCount - a.missingCount);
    
    // Gesamtstatistik - Geräte-basiert
    const totalTech = visibleTechniker.length;
    const techWithGaps = techAnalysis.filter(t => t.missingCount > 0).length;
    
    // Berechne Geräte-Coverage
    let totalDevices = 0;
    let coveredDevices = 0;
    let fullyCoveredCustomers = 0;
    
    visibleKunden.forEach(kunde => {
        const devices = (kunde.instrumentLines || []).filter(line => line && line.trim());
        totalDevices += devices.length;
        coveredDevices += kunde.coveredDevices || 0;
        if (kunde.covered) fullyCoveredCustomers++;
    });
    
    const deviceCoveragePercent = totalDevices > 0 ? Math.round((coveredDevices / totalDevices) * 100) : 0;
    
    // HTML aufbauen
    let html = `
        <div class="strategy-legend" style="display: flex; gap: 12px; font-size: 10px; margin-bottom: 12px; padding: 8px; background: #f8f9fa; border-radius: 6px; flex-wrap: wrap;">
            <span style="display: flex; align-items: center; gap: 4px;">
                <span style="background: linear-gradient(90deg, #576574, #8395a7); color: white; padding: 2px 6px; border-radius: 50%; font-size: 9px; font-weight: bold;">T</span> Techniker
            </span>
            <span style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 14px;">🏢</span> Abgedeckt
            </span>
            <span style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 14px;">⚠️</span> Nicht abgedeckt
            </span>
        </div>
        
        <div class="strategy-summary">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                <div>
                    <div class="strategy-summary-number">${techWithGaps}</div>
                    <div class="strategy-summary-label">Techniker mit Lücken</div>
                </div>
                <div>
                    <div class="strategy-summary-number">${deviceCoveragePercent}%</div>
                    <div class="strategy-summary-label">Geräte-Abdeckung</div>
                </div>
            </div>
        </div>
        
        <div style="font-size: 12px; color: #6c757d; margin-bottom: 15px;">
            🎯 <strong>Strategiemodus</strong>: Alle ${totalTech} Techniker als verfügbar<br>
            🔧 ${coveredDevices}/${totalDevices} Geräte abgedeckt | ✅ ${fullyCoveredCustomers} vollständig abgedeckte Kunden<br>
            ${activeRSLFilters.size > 0 ? `🏢 Filter: ${Array.from(activeRSLFilters).join(', ')}` : ''}
        </div>
    `;
    
    if (techAnalysis.length === 0) {
        html += `
            <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; text-align: center;">
                <p style="color: #6c757d; margin: 0;">Keine Techniker mit Isochronen gefunden.</p>
            </div>
        `;
    } else {
        // Techniker mit Lücken zuerst
        const techWithMissing = techAnalysis.filter(t => t.missingCount > 0);
        const techComplete = techAnalysis.filter(t => t.missingCount === 0);
        
        if (techWithMissing.length > 0) {
            html += `<h4 style="font-size: 13px; color: #dc3545; margin-bottom: 10px;">⚠️ Skill-Lücken (${techWithMissing.length})</h4>`;
            
            techWithMissing.forEach(analysis => {
                const tech = analysis.tech;
                const rslInfo = tech.rsl ? `<div class="strategy-tech-rsl">🏢 ${tech.rsl}</div>` : '';
                
                html += `
                    <div class="strategy-tech-card has-gaps">
                        <div class="strategy-tech-name">${tech.name}</div>
                        ${rslInfo}
                        <div class="strategy-missing-skills">
                `;
                
                // Sortiere Skills nach Anzahl Kunden
                const sortedSkills = Array.from(analysis.missingSkills.entries())
                    .sort((a, b) => b[1].length - a[1].length);
                
                sortedSkills.forEach(([skill, customers]) => {
                    const skillId = `skill_${tech.id}_${skill.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    html += `
                        <span class="strategy-skill-badge" onclick="toggleSkillCustomers('${skillId}', ${tech.id}, '${skill.replace(/'/g, "\\'")}')">
                            ${skill}<span class="strategy-skill-count">${customers.length}</span>
                        </span>
                    `;
                });
                
                html += `
                        </div>
                        <div id="skill_${tech.id}_customers" class="strategy-customer-list" style="display: none;"></div>
                    </div>
                `;
            });
        }
        
        if (techComplete.length > 0) {
            html += `
                <h4 style="font-size: 13px; color: #28a745; margin: 15px 0 10px 0;">✅ Vollständig abgedeckt (${techComplete.length})</h4>
                <div style="font-size: 12px; color: #6c757d;">
            `;
            
            techComplete.slice(0, 5).forEach(analysis => {
                html += `<span style="background: #d4edda; padding: 4px 8px; margin: 2px; border-radius: 4px; display: inline-block;">${analysis.tech.name}</span>`;
            });
            
            if (techComplete.length > 5) {
                html += `<span style="color: #6c757d; font-style: italic;"> +${techComplete.length - 5} weitere</span>`;
            }
            
            html += `</div>`;
        }
    }
    
    content.innerHTML = html;
}

// Kunden für einen Skill anzeigen/verstecken
function toggleSkillCustomers(skillId, techId, skillName) {
    // Finde alle Customer-Lists und verstecke sie
    const allLists = document.querySelectorAll('.strategy-customer-list');
    allLists.forEach(list => {
        if (list.id !== `skill_${techId}_customers`) {
            list.style.display = 'none';
            list.innerHTML = '';
        }
    });
    
    const listContainer = document.getElementById(`skill_${techId}_customers`);
    
    if (listContainer.style.display === 'block' && listContainer.dataset.skill === skillName) {
        listContainer.style.display = 'none';
        listContainer.innerHTML = '';
        return;
    }
    
    // Finde Techniker und dessen Isochrone
    const tech = techniker.find(t => t.id === techId);
    const techIsochrone = isochroneGeoJSON.find(iso => iso.techId === techId);
    
    if (!tech || !techIsochrone) return;
    
    // Finde Kunden mit diesem Skill im Bereich
    const visibleKunden = kunden.filter(k => k.visible !== false);
    const matchingCustomers = visibleKunden.filter(kunde => {
        // In Reichweite?
        if (!isPointInPolygon(kunde.lng, kunde.lat, techIsochrone.feature.geometry)) {
            return false;
        }
        
        // Hat diesen Skill? - Nur gefilterte instrumentLines prüfen
        if (!kunde.instrumentLines) return false;
        
        const filteredLines = kunde.instrumentLines.filter(line => 
            activeInstrumentLineFilters.has(line)
        );
        
        return filteredLines.some(line => {
            return line.toLowerCase().includes(skillName.toLowerCase()) || 
                   skillName.toLowerCase().includes(line.toLowerCase());
        });
    });
    
    // HTML für Kundenliste
    let html = `<div style="padding: 8px; background: #f8f9fa; font-weight: 600; font-size: 11px; border-bottom: 1px solid #e0e0e0;">
        📋 Kunden mit "${skillName}" (${matchingCustomers.length})
    </div>`;
    
    matchingCustomers.forEach(kunde => {
        html += `
            <div class="strategy-customer-item" onclick="zoomToLocation(${kunde.lat}, ${kunde.lng})">
                <strong>${kunde.name}</strong><br>
                <small style="color: #6c757d;">${kunde.ort || ''}</small>
            </div>
        `;
    });
    
    listContainer.innerHTML = html;
    listContainer.style.display = 'block';
    listContainer.dataset.skill = skillName;
}

// Analyse-Panel Resize initialisieren
function initAnalysisPanelResize() {
    const panel = document.getElementById('analysisPanel');
    let isResizing = false;
    let startX, startY, startWidth, startHeight;
    
    panel.addEventListener('mousedown', (e) => {
        // Prüfe ob am Rand geklickt wurde (unten rechts)
        const rect = panel.getBoundingClientRect();
        const isBottomRight = (rect.right - e.clientX < 20) && (rect.bottom - e.clientY < 20);
        
        if (isBottomRight) {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = panel.offsetWidth;
            startHeight = panel.offsetHeight;
            e.preventDefault();
        }
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        
        panel.style.width = Math.max(280, Math.min(600, newWidth)) + 'px';
        panel.style.height = Math.max(200, Math.min(window.innerHeight * 0.8, newHeight)) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

// Initialisierung für Strategiemodus
document.addEventListener('DOMContentLoaded', function() {
    // Modus-Labels initialisieren
    setTimeout(() => {
        const calendarLabel = document.getElementById('modeLabelCalendar');
        if (calendarLabel) calendarLabel.classList.add('active');
        
        initAnalysisPanelResize();
        initNotesWindow();
    }, 100);
});

// ===== NOTIZEN-FENSTER FUNKTIONALITÄT =====

// Notizen-Fenster öffnen/schließen
function toggleNotesWindow() {
    const notesWindow = document.getElementById('notesWindow');
    notesWindow.classList.toggle('active');
    
    // Lade Notizen beim ersten Öffnen
    if (notesWindow.classList.contains('active')) {
        loadNotes();
    }
}

// Notizen-Fenster initialisieren
function initNotesWindow() {
    initNotesWindowDrag();
    initNotesWindowResize();
    initNotesAutoSave();
    loadNotes();
}

// Drag-Funktionalität für Notizen-Fenster
function initNotesWindowDrag() {
    const notesWindow = document.getElementById('notesWindow');
    const header = document.getElementById('notesHeader');
    
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;
    
    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    function dragStart(e) {
        // Nur dragging starten wenn nicht der Close-Button geklickt wurde
        if (e.target.classList.contains('notes-btn-close')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        
        if (e.target === header || e.target.parentElement === header) {
            isDragging = true;
            header.style.cursor = 'grabbing';
        }
    }
    
    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            xOffset = currentX;
            yOffset = currentY;
            
            setTranslate(currentX, currentY, notesWindow);
        }
    }
    
    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
        header.style.cursor = 'move';
    }
    
    function setTranslate(xPos, yPos, el) {
        el.style.transform = `translate(calc(-50% + ${xPos}px), ${yPos}px)`;
    }
}

// Resize-Funktionalität für Notizen-Fenster
function initNotesWindowResize() {
    const notesWindow = document.getElementById('notesWindow');
    const resizeHandle = document.getElementById('notesResizeHandle');
    
    let isResizing = false;
    let startX, startY;
    let startWidth, startHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = notesWindow.offsetWidth;
        startHeight = notesWindow.offsetHeight;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        
        notesWindow.style.width = Math.max(300, Math.min(window.innerWidth * 0.9, newWidth)) + 'px';
        notesWindow.style.height = Math.max(200, Math.min(window.innerHeight * 0.8, newHeight)) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

// Auto-Save für Notizen (speichert nach 1 Sekunde Inaktivität)
function initNotesAutoSave() {
    const textarea = document.getElementById('notesTextarea');
    let saveTimeout;
    
    textarea.addEventListener('input', () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveNotes();
        }, 1000);
    });
}

// Notizen speichern
function saveNotes() {
    const textarea = document.getElementById('notesTextarea');
    const notes = textarea.value;
    
    try {
        localStorage.setItem('app_notes', notes);
        console.log('📝 Notizen gespeichert');
    } catch (error) {
        console.error('❌ Fehler beim Speichern der Notizen:', error);
    }
}

// Notizen laden
function loadNotes() {
    const textarea = document.getElementById('notesTextarea');
    
    try {
        const savedNotes = localStorage.getItem('app_notes');
        if (savedNotes) {
            textarea.value = savedNotes;
            console.log('📝 Notizen geladen');
        }
    } catch (error) {
        console.error('❌ Fehler beim Laden der Notizen:', error);
    }
}

// ===== INSTALLATION PLANNING FUNKTIONEN =====

// Projektleiter-Dropdown füllen (nur Techniker aus gefiltertem Teamgebiet)
// Planungsmodus zurücksetzen
function resetInstallationPlanning() {
    installationPlanningMode = false;
    selectedProjectLeader = null;
    selectedProjectSize = null;
    plannedInstallationDays = [];
    
    const sizeSelect = document.getElementById('projectSizeSelect');
    if (sizeSelect) {
        sizeSelect.value = '';
    }
    document.getElementById('planningInstructions').style.display = 'none';
}

// Event Listener für Installation Planning
document.addEventListener('DOMContentLoaded', function() {
    const startPlanningBtn = document.getElementById('startProjectPlanningBtn');
    if (startPlanningBtn) {
        startPlanningBtn.addEventListener('click', startProjectPlanning);
    }
    
    const showAnalysisBtn = document.getElementById('showInstallationAnalysisBtn');
    if (showAnalysisBtn) {
        showAnalysisBtn.addEventListener('click', showLastInstallationAnalysis);
    }
    
    const showMonthAnalysisBtn = document.getElementById('showMonthAnalysisBtn');
    if (showMonthAnalysisBtn) {
        showMonthAnalysisBtn.addEventListener('click', showMonthAnalysis);
    }
    
    // Initialisiere Drag & Resize für Installationsanalyse Modal
    initInstallationAnalysisDrag();
    initInstallationAnalysisResize();
});

// Projekt-Planung starten
function startProjectPlanning() {
    const sizeSelect = document.getElementById('projectSizeSelect');
    
    if (!sizeSelect.value) {
        alert('❌ Bitte wählen Sie einen Projektumfang aus!');
        return;
    }
    
    selectedProjectSize = sizeSelect.value;
    installationPlanningMode = true;
    selectedProjectLeader = null; // Wird beim Klick auf Techniker gesetzt
    
    // Zeige Anweisungen
    document.getElementById('planningInstructions').style.display = 'block';
    
    console.log(`📅 Planungsmodus aktiviert, Größe: ${selectedProjectSize}`);
}

// Prüfe ob ein Datum ein Feiertag ist (Platzhalter - kann erweitert werden)
function isHoliday(date) {
    // Aktuell: Keine Feiertage definiert
    // TODO: Feiertags-Liste hinzufügen wenn gewünscht
    return false;
}

// Berechne Installations-Tage basierend auf Starttag und Projektgröße
function calculateInstallationDays(startDate) {
    const days = [];
    let daysNeeded = 0;
    
    switch (selectedProjectSize) {
        case 'S': daysNeeded = 5; break;   // 1 Woche
        case 'M': daysNeeded = 10; break;  // 2 Wochen
        case 'XL': daysNeeded = 15; break; // 3 Wochen
    }
    
    let currentDate = new Date(startDate);
    let addedDays = 0;
    
    while (addedDays < daysNeeded) {
        const dayOfWeek = currentDate.getDay();
        
        // Nur Mo-Fr (1-5), keine Feiertage
        if (dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday(currentDate)) {
            days.push(new Date(currentDate));
            addedDays++;
        }
        
        // Nächster Tag
        currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
}

// Installation eintragen
function scheduleInstallation(startDate) {
    const techId = selectedProjectLeader;
    const tech = techniker.find(t => t.id == techId);
    
    if (!tech) {
        alert('❌ Fehler: Techniker nicht gefunden!');
        return;
    }
    
    const days = calculateInstallationDays(startDate);
    
    plannedInstallationDays = days;
    
    // Trage "I" für alle Tage ein
    days.forEach(date => {
        const dateStr = formatDate(date);
        
        if (!schedule[techId]) {
            schedule[techId] = {};
        }
        
        // Überschreibe Status (außer Feiertage sind bereits ausgeschlossen)
        schedule[techId][dateStr] = 'I';
    });
    
    // Speichern
    saveToLocalStorage();
    
    // Kalender neu rendern
    renderFullscreenCalendar();
    
    // Planungsmodus beenden
    installationPlanningMode = false;
    document.getElementById('planningInstructions').style.display = 'none';
    
    // Zeige Erfolgsmeldung
    alert(`✅ Installation erfolgreich eingetragen!\n\n${days.length} Arbeitstage für ${tech.name}\nVon ${formatDateGerman(days[0])} bis ${formatDateGerman(days[days.length - 1])}\n\nTipp: Klicken Sie auf "Installationsanalyse" um die Abdeckung während dieser Zeit zu prüfen.`);
}

// Installations-Analyse durchführen (Team-basiert)
function performInstallationAnalysis(days, techId = null) {
    // Wenn keine techId angegeben, dann Team-Analyse
    const isTeamAnalysis = !techId;
    
    let tech = null;
    if (techId) {
        tech = techniker.find(t => t.id == techId);
        if (!tech) {
            alert('❌ Fehler: Techniker nicht gefunden!');
            return;
        }
    }
    
    // Speichere aktuelles selectedDate
    const originalSelectedDate = selectedDate;
    
    const analysisData = [];
    
    days.forEach(date => {
        // Setze das selectedDate auf diesen Tag
        selectedDate = new Date(date);
        
        // Führe Coverage-Check durch
        checkCustomerCoverage();
        
        // Berechne Abdeckung für diesen Tag
        const visibleKunden = kunden.filter(k => k.visible !== false);
        
        let totalDevices = 0;
        let coveredDevices = 0;
        let totalWeight = 0;
        let coveredWeight = 0;
        
        visibleKunden.forEach(kunde => {
            if (!Array.isArray(kunde.instrumentLines)) {
                kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
            }
            
            const allDevices = kunde.instrumentLines.filter(line => line && line.trim());
            const devices = allDevices.filter(line => activeInstrumentLineFilters.has(line));
            
            totalDevices += devices.length;
            
            // Berechne Gewichtung
            devices.forEach(device => {
                const weight = deviceWeights[device] || 1.0;
                totalWeight += weight;
            });
            
            // Zähle abgedeckte Geräte und deren Gewicht
            const covered = kunde.coveredDevices || 0;
            coveredDevices += covered;
            
            // Gewicht der abgedeckten Geräte berechnen
            if (kunde.instrumentLines) {
                let coveredCount = 0;
                kunde.instrumentLines.forEach(device => {
                    if (activeInstrumentLineFilters.has(device)) {
                        // Prüfe ob dieses Gerät abgedeckt ist
                        if (coveredCount < covered) {
                            const weight = deviceWeights[device] || 1.0;
                            coveredWeight += weight;
                            coveredCount++;
                        }
                    }
                });
            }
        });
        
        const coveragePercent = totalWeight > 0 ? ((coveredWeight / totalWeight) * 100).toFixed(1) : 0;
        
        // === TECHNIKER-AUSLASTUNG FÜR DIESEN TAG ===
        const dateStr = formatDate(selectedDate);
        const technicianWorkload = new Map();
        let overloadedCount = 0;
        let totalOverload = 0;
        
        // Ermittle ZR-Techniker für diesen Tag
        const zrTechniker = techniker.filter(t => {
            if (!t.active || t.visible === false) return false;
            const status = getScheduleStatus(t.id, dateStr);
            return status === 'ZR';
        });
        
        // Initialisiere Workload
        zrTechniker.forEach(tech => {
            technicianWorkload.set(tech.id, 0);
        });
        
        // Berechne Auslastung (anteilig bei Mehrfachabdeckung)
        visibleKunden.forEach(kunde => {
            if (!Array.isArray(kunde.instrumentLines)) return;
            
            const devices = kunde.instrumentLines.filter(line => 
                line && line.trim() && activeInstrumentLineFilters.has(line)
            );
            
            devices.forEach(instrumentLine => {
                const instrumentName = instrumentLine.toLowerCase();
                const deviceWeight = deviceWeights[instrumentLine] || 1.0;
                const coveringTechnicians = [];
                
                // Finde alle Techniker die dieses Gerät abdecken können
                for (const isoData of isochroneGeoJSON) {
                    const tech = techniker.find(t => t.name === isoData.name && t.active);
                    if (!tech || tech.visible === false) continue;
                    
                    const techStatus = getScheduleStatus(tech.id, dateStr);
                    if (techStatus !== 'ZR') continue;
                    
                    // Skill-Check
                    const skillMatch = tech.skills && tech.skills.some(skill => {
                        const skillLower = skill.toLowerCase().trim();
                        const escapedSkill = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp('\\b' + escapedSkill + '\\b', 'i');
                        return regex.test(instrumentName);
                    });
                    
                    if (!skillMatch) continue;
                    
                    // Geo-Check
                    if (isPointInPolygon(kunde.lng, kunde.lat, isoData.feature.geometry)) {
                        coveringTechnicians.push(tech.id);
                    }
                }
                
                // Gewicht anteilig verteilen
                if (coveringTechnicians.length > 0) {
                    const weightPerTechnician = deviceWeight / coveringTechnicians.length;
                    coveringTechnicians.forEach(techId => {
                        const currentLoad = technicianWorkload.get(techId) || 0;
                        technicianWorkload.set(techId, currentLoad + weightPerTechnician);
                    });
                }
            });
        });
        
        // Berechne Überlastung für diesen Tag
        technicianWorkload.forEach((workload, techId) => {
            if (workload > overloadThreshold) {
                overloadedCount++;
                const excessLoad = ((workload / overloadThreshold) - 1) * 100; // Überlastung in %
                totalOverload += excessLoad;
            }
        });
        
        const avgOverloadForDay = overloadedCount > 0 ? totalOverload / overloadedCount : 0;
        
        analysisData.push({
            date: new Date(date),
            dateStr: formatDateGerman(date),
            coveragePercent: coveragePercent,
            totalDevices: totalDevices,
            coveredDevices: coveredDevices,
            totalWeight: totalWeight,
            coveredWeight: coveredWeight,
            overloadedTechnicians: overloadedCount,
            avgOverload: avgOverloadForDay
        });
    });
    
    // Stelle ursprüngliches selectedDate wieder her
    selectedDate = originalSelectedDate;
    
    // Zeige Analyse-Modal
    showInstallationAnalysis(tech, analysisData);
}

// Installations-Analyse Modal anzeigen
function showInstallationAnalysis(tech, analysisData) {
    const modal = document.getElementById('installationAnalysisModal');
    const content = document.getElementById('installationAnalysisContent');
    
    // Berechne Durchschnitt Abdeckung
    const avgCoverage = analysisData.reduce((sum, day) => sum + parseFloat(day.coveragePercent), 0) / analysisData.length;
    
    // Berechne durchschnittliche Überlastung (nur über Tage mit Überlastung)
    const daysWithOverload = analysisData.filter(day => day.avgOverload > 0);
    const avgOverload = daysWithOverload.length > 0 
        ? daysWithOverload.reduce((sum, day) => sum + day.avgOverload, 0) / daysWithOverload.length 
        : 0;
    
    // === EFFIZIENZ-SCORE BERECHNUNG ===
    // E = C / (1 + α * O)
    const efficiencyScore = avgCoverage / (1 + penaltyWeight * avgOverload);
    
    // Berechne Start- und Enddatum
    const startDate = analysisData[0].dateStr;
    const endDate = analysisData[analysisData.length - 1].dateStr;
    
    // Ermittle Team-Info
    const allTeams = new Set();
    techniker.forEach(t => {
        if (t.rsl && t.rsl.trim()) {
            allTeams.add(t.rsl.trim());
        }
    });
    const isTeamFilterActive = activeRSLFilters.size > 0 && activeRSLFilters.size < allTeams.size;
    
    let teamInfo = '';
    if (isTeamFilterActive) {
        const teamList = Array.from(activeRSLFilters).join(', ');
        teamInfo = `Team: ${teamList}`;
    } else {
        teamInfo = 'Alle Teams';
    }
    
    // Farbe für Effizienz-Score
    const effColor = efficiencyScore >= 80 ? '#28a745' : 
                     efficiencyScore >= 60 ? '#ffc107' : '#dc3545';
    const effTextColor = efficiencyScore >= 60 && efficiencyScore < 80 ? '#000' : '#fff';
    
    let html = `
        <!-- EFFIZIENZ-SCORE HEADER (PROMINENT) -->
        <div style="background: linear-gradient(135deg, ${effColor} 0%, ${effColor}dd 100%); color: ${effTextColor}; padding: 25px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 6px 20px rgba(0,0,0,0.15);">
            <h3 style="margin: 0 0 5px 0; font-size: 16px; opacity: 0.9;">⚡ Effizienz-Score</h3>
            <div style="font-size: 48px; font-weight: bold; margin: 10px 0;">
                ${efficiencyScore.toFixed(1)}
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px; font-size: 14px;">
                <div>
                    <div style="opacity: 0.9; font-size: 12px;">Ø Abdeckung</div>
                    <div style="font-size: 20px; font-weight: 600;">${avgCoverage.toFixed(1)}%</div>
                </div>
                <div>
                    <div style="opacity: 0.9; font-size: 12px;">Ø Überlastung</div>
                    <div style="font-size: 20px; font-weight: 600;">${avgOverload > 0 ? '+' : ''}${avgOverload.toFixed(1)}%</div>
                </div>
            </div>
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.3); font-size: 12px; opacity: 0.95;">
                📊 ${tech ? tech.name : teamInfo} • ${startDate} - ${endDate} (${analysisData.length} Tage)
            </div>
        </div>
        
        <div style="background: #e7f3ff; border-left: 4px solid #667eea; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
            <strong style="color: #004085; font-size: 13px;">ℹ️ Effizienz-Score Formel:</strong><br>
            <span style="color: #004085; font-size: 12px;">
                E = Abdeckung / (1 + ${penaltyWeight.toFixed(3)} × Überlastung)<br>
                <em>Je höher der Score, desto besser die Balance zwischen Abdeckung und Auslastung.</em>
            </span>
        </div>
        
        <h3 style="color: #495057; margin-bottom: 15px;">📊 Tagesübersicht</h3>
        <div style="display: grid; gap: 12px;">
    `;
    
    analysisData.forEach(day => {
        const color = day.coveragePercent >= 80 ? '#28a745' : 
                     day.coveragePercent >= 50 ? '#ffc107' : '#dc3545';
        const textColor = day.coveragePercent >= 50 && day.coveragePercent < 80 ? '#000' : '#fff';
        
        html += `
            <div style="display: grid; grid-template-columns: 150px 1fr 120px; gap: 15px; align-items: center; padding: 12px; background: #f8f9fa; border-radius: 6px;">
                <div style="font-weight: 600; color: #495057;">
                    ${day.dateStr}
                </div>
                <div style="background: #e9ecef; border-radius: 4px; height: 24px; position: relative; overflow: hidden;">
                    <div style="background: ${color}; height: 100%; width: ${day.coveragePercent}%; transition: width 0.3s;"></div>
                </div>
                <div style="text-align: right; font-weight: 600; color: ${color};">
                    ${day.coveragePercent}%
                </div>
            </div>
        `;
    });
    
    const hintText = tech 
        ? `Die gewichtete Abdeckung zeigt den Anteil der Geräte-Gewichtseinheiten, die durch ZR-Techniker abgedeckt sind, während ${tech.name} die Installation durchführt.`
        : `Die gewichtete Abdeckung zeigt den Anteil der Geräte-Gewichtseinheiten, die durch ${isTeamFilterActive ? 'das gefilterte Team' : 'alle verfügbaren Teams'} abgedeckt sind.`;
    
    html += `
        </div>
        <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-left: 4px solid #667eea; border-radius: 4px;">
            <strong style="color: #004085;">ℹ️ Hinweis:</strong><br>
            <span style="color: #004085; font-size: 13px;">
                ${hintText}<br><br>
                <strong>Gewichtseinheiten:</strong> Geräte werden nach ihrer konfigurierten Gewichtung bewertet (z.B. Pro = 3.0, Pure = 2.5, Standard = 1.0). Dies ermöglicht eine realistische Bewertung der Auslastung.
            </span>
        </div>
    `;
    
    content.innerHTML = html;
    
    // Zeige Modal (Position wird durch CSS/Drag beibehalten)
    modal.style.display = 'block';
}

// Installations-Analyse schließen
function closeInstallationAnalysis() {
    document.getElementById('installationAnalysisModal').style.display = 'none';
}

// Zeige Analyse für gewählten Zeitraum - Startet Auswahlmodus
function showLastInstallationAnalysis() {
    // Starte Analyse-Modus direkt (Team-basiert, kein spezifischer Projektleiter)
    installationAnalysisMode = true;
    analysisStartDate = null;
    analysisEndDate = null;
    analysisProjectLeader = null; // Null = Team-Analyse
    
    // Zeige Anweisungen
    const instructionsDiv = document.createElement('div');
    instructionsDiv.id = 'analysisInstructions';
    instructionsDiv.style.cssText = `
        position: fixed;
        top: 100px;
        right: 30px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 20px 30px;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        z-index: 10001;
        text-align: center;
        font-size: 16px;
        max-width: 350px;
        cursor: move;
    `;
    instructionsDiv.innerHTML = `
        <strong style="font-size: 18px;">📊 Installationsanalyse</strong><br><br>
        <span style="font-size: 14px;">Bitte wählen Sie den <strong>Starttag</strong> im Kalender</span><br><br>
        <button onclick="cancelInstallationAnalysis()" style="
            background: white;
            color: #667eea;
            border: none;
            padding: 8px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
        ">Abbrechen</button>
    `;
    document.body.appendChild(instructionsDiv);
    
    // Mache Anweisungen verschiebbar
    makeInstructionsDraggable(instructionsDiv);
    
    console.log('📊 Analyse-Modus aktiviert (Team-Analyse)');
}

// Macht Anweisungs-Popup verschiebbar
function makeInstructionsDraggable(element) {
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;
    
    element.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    function dragStart(e) {
        // Nicht bei Button-Klicks
        if (e.target.tagName === 'BUTTON') return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        isDragging = true;
        element.style.cursor = 'grabbing';
    }
    
    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            xOffset = currentX;
            yOffset = currentY;
            
            element.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }
    
    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
        element.style.cursor = 'move';
    }
}

// Installations-Analyse abbrechen
function cancelInstallationAnalysis() {
    installationAnalysisMode = false;
    analysisStartDate = null;
    analysisEndDate = null;
    analysisProjectLeader = null;
    
    const instructionsDiv = document.getElementById('analysisInstructions');
    if (instructionsDiv) {
        instructionsDiv.remove();
    }
    
    renderFullscreenCalendar();
    console.log('❌ Analyse-Modus abgebrochen');
}

// Drag-Funktionalität für Installationsanalyse Modal
function initInstallationAnalysisDrag() {
    const modal = document.getElementById('installationAnalysisModalContent');
    const header = document.getElementById('installationAnalysisHeader');
    
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    let xOffset = 0;
    let yOffset = 0;
    
    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    function dragStart(e) {
        if (e.target.classList.contains('close')) return;
        
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
        
        if (e.target === header || header.contains(e.target)) {
            isDragging = true;
            header.style.cursor = 'grabbing';
        }
    }
    
    function drag(e) {
        if (isDragging) {
            e.preventDefault();
            
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            xOffset = currentX;
            yOffset = currentY;
            
            modal.style.transform = `translate(${currentX}px, ${currentY}px)`;
        }
    }
    
    function dragEnd(e) {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
        header.style.cursor = 'move';
    }
}

// Resize-Funktionalität für Installationsanalyse Modal
function initInstallationAnalysisResize() {
    const modal = document.getElementById('installationAnalysisModalContent');
    const resizeHandle = document.getElementById('installationAnalysisResizeHandle');
    
    let isResizing = false;
    let startX, startY;
    let startWidth, startHeight;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startWidth = modal.offsetWidth;
        startHeight = modal.offsetHeight;
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const newWidth = startWidth + (e.clientX - startX);
        const newHeight = startHeight + (e.clientY - startY);
        
        modal.style.width = Math.max(400, Math.min(window.innerWidth * 0.95, newWidth)) + 'px';
        modal.style.height = Math.max(300, Math.min(window.innerHeight * 0.9, newHeight)) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isResizing = false;
    });
}

// Monatsanalyse anzeigen
function showMonthAnalysis() {
    const year = currentCalendarMonth.getFullYear();
    const month = currentCalendarMonth.getMonth();
    const monthNames = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 
                        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const monthName = monthNames[month];
    
    // Berechne alle Tage im Monat
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Sammle Statistiken pro Techniker
    const techStats = {};
    const visibleTechniker = techniker.filter(tech => tech.visible !== false);
    
    visibleTechniker.forEach(tech => {
        techStats[tech.id] = {
            name: tech.name,
            rsl: tech.rsl || '',
            ZR: 0,
            X: 0,
            I: 0,
            W: 0,
            K: 0,
            U: 0,
            empty: 0,
            total: 0
        };
    });
    
    // Zähle Status-Codes für jeden Tag
    const dailyCoverage = [];
    
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const dateStr = formatDate(date);
        const dayOfWeek = date.getDay();
        
        // Nur Arbeitstage (Mo-Fr)
        if (dayOfWeek >= 1 && dayOfWeek <= 5 && !isHoliday(date)) {
            visibleTechniker.forEach(tech => {
                const status = getScheduleStatus(tech.id, dateStr);
                if (status && STATUS_TYPES[status]) {
                    techStats[tech.id][status]++;
                } else {
                    techStats[tech.id].empty++;
                }
                techStats[tech.id].total++;
            });
            
            // Berechne Coverage für diesen Tag
            const originalSelectedDate = selectedDate;
            selectedDate = date;
            checkCustomerCoverage();
            
            const visibleKunden = kunden.filter(k => k.visible !== false);
            let totalDevices = 0;
            let coveredDevices = 0;
            
            visibleKunden.forEach(kunde => {
                if (!Array.isArray(kunde.instrumentLines)) {
                    kunde.instrumentLines = kunde.instrumentLineName ? [kunde.instrumentLineName] : [];
                }
                
                const allDevices = kunde.instrumentLines.filter(line => line && line.trim());
                const devices = allDevices.filter(line => activeInstrumentLineFilters.has(line));
                
                totalDevices += devices.length;
                coveredDevices += kunde.coveredDevices || 0;
            });
            
            const coveragePercent = totalDevices > 0 ? ((coveredDevices / totalDevices) * 100).toFixed(1) : 0;
            
            dailyCoverage.push({
                day: day,
                date: date,
                dateStr: formatDateGerman(date),
                coveragePercent: parseFloat(coveragePercent),
                totalDevices: totalDevices,
                coveredDevices: coveredDevices
            });
            
            // Stelle selectedDate wieder her
            selectedDate = originalSelectedDate;
        }
    }
    
    // Generiere HTML
    const modal = document.getElementById('monthAnalysisModal');
    const content = document.getElementById('monthAnalysisContent');
    
    let html = `
        <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 5px 0; font-size: 24px;">${monthName} ${year}</h3>
            <p style="margin: 0; opacity: 0.9;">Monatsübersicht aller Techniker</p>
        </div>
        
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <thead>
                    <tr style="background: #f8f9fa; border-bottom: 2px solid #dee2e6;">
                        <th style="padding: 10px; text-align: left; font-weight: 600;">Techniker</th>
                        <th style="padding: 10px; text-align: left; font-weight: 600;">Team</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #fd7e14; color: white;">ZR</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #dc3545; color: white;">X</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #6f42c1; color: white;">I</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #ffc107;">W</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #20c997; color: white;">K</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #17a2b8; color: white;">U</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600; background: #6c757d; color: white;">Leer</th>
                        <th style="padding: 10px; text-align: center; font-weight: 600;">Gesamt</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    visibleTechniker.forEach((tech, index) => {
        const stats = techStats[tech.id];
        const rowBg = index % 2 === 0 ? '#ffffff' : '#f8f9fa';
        
        html += `
            <tr style="background: ${rowBg}; border-bottom: 1px solid #dee2e6;">
                <td style="padding: 8px; font-weight: 500;">${stats.name}</td>
                <td style="padding: 8px; color: #6c757d; font-size: 12px;">${stats.rsl}</td>
                <td style="padding: 8px; text-align: center;">${stats.ZR}</td>
                <td style="padding: 8px; text-align: center;">${stats.X}</td>
                <td style="padding: 8px; text-align: center;">${stats.I}</td>
                <td style="padding: 8px; text-align: center;">${stats.W}</td>
                <td style="padding: 8px; text-align: center;">${stats.K}</td>
                <td style="padding: 8px; text-align: center;">${stats.U}</td>
                <td style="padding: 8px; text-align: center; color: #dc3545;">${stats.empty}</td>
                <td style="padding: 8px; text-align: center; font-weight: 600;">${stats.total}</td>
            </tr>
        `;
    });
    
    // Summen-Zeile
    let totalZR = 0, totalX = 0, totalI = 0, totalW = 0, totalK = 0, totalU = 0, totalEmpty = 0, totalDays = 0;
    visibleTechniker.forEach(tech => {
        const stats = techStats[tech.id];
        totalZR += stats.ZR;
        totalX += stats.X;
        totalI += stats.I;
        totalW += stats.W;
        totalK += stats.K;
        totalU += stats.U;
        totalEmpty += stats.empty;
        totalDays += stats.total;
    });
    
    html += `
                <tr style="background: #e9ecef; font-weight: 600; border-top: 2px solid #dee2e6;">
                    <td style="padding: 10px;" colspan="2">SUMME</td>
                    <td style="padding: 10px; text-align: center;">${totalZR}</td>
                    <td style="padding: 10px; text-align: center;">${totalX}</td>
                    <td style="padding: 10px; text-align: center;">${totalI}</td>
                    <td style="padding: 10px; text-align: center;">${totalW}</td>
                    <td style="padding: 10px; text-align: center;">${totalK}</td>
                    <td style="padding: 10px; text-align: center;">${totalU}</td>
                    <td style="padding: 10px; text-align: center; color: #dc3545;">${totalEmpty}</td>
                    <td style="padding: 10px; text-align: center;">${totalDays}</td>
                </tr>
            </tbody>
        </table>
        </div>
        
        <div style="margin-top: 30px;">
            <h3 style="color: #495057; margin-bottom: 15px;">📊 Tägliche Geräteabdeckung</h3>
            <div style="display: grid; gap: 8px;">
    `;
    
    // Berechne Durchschnitts-Coverage
    const avgCoverage = dailyCoverage.length > 0 
        ? (dailyCoverage.reduce((sum, day) => sum + day.coveragePercent, 0) / dailyCoverage.length).toFixed(1)
        : 0;
    
    html += `
            <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 15px; border-radius: 8px; text-align: center; margin-bottom: 10px;">
                <div style="font-size: 28px; font-weight: bold;">${avgCoverage}%</div>
                <div style="opacity: 0.9; font-size: 13px;">Durchschnittliche Abdeckung (${dailyCoverage.length} Arbeitstage)</div>
            </div>
    `;
    
    dailyCoverage.forEach(day => {
        const color = day.coveragePercent >= 80 ? '#28a745' : 
                     day.coveragePercent >= 50 ? '#ffc107' : '#dc3545';
        
        html += `
            <div style="display: grid; grid-template-columns: 120px 1fr 100px; gap: 15px; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                <div style="font-weight: 600; color: #495057; font-size: 13px;">
                    ${day.dateStr}
                </div>
                <div style="background: #e9ecef; border-radius: 4px; height: 20px; position: relative; overflow: hidden;">
                    <div style="background: ${color}; height: 100%; width: ${day.coveragePercent}%; transition: width 0.3s;"></div>
                </div>
                <div style="text-align: right; font-weight: 600; color: ${color}; font-size: 13px;">
                    ${day.coveragePercent}%
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-left: 4px solid #28a745; border-radius: 4px;">
            <strong style="color: #004085;">ℹ️ Legende:</strong><br>
            <span style="color: #004085; font-size: 12px;">
                <strong>ZR</strong> = Bereitschaft | <strong>X</strong> = Abwesend | <strong>I</strong> = Installation | 
                <strong>W</strong> = Wartung | <strong>K</strong> = Krank | <strong>U</strong> = Urlaub | <strong>Leer</strong> = Nicht geplant
            </span>
        </div>
    `;
    
    content.innerHTML = html;
    
    // Speichere Daten für PDF
    window.currentMonthAnalysisData = {
        year,
        month,
        monthName,
        techStats,
        visibleTechniker,
        totalZR,
        totalX,
        totalI,
        totalW,
        totalK,
        totalU,
        totalEmpty,
        totalDays,
        dailyCoverage,
        avgCoverage: avgCoverage
    };
    
    modal.style.display = 'block';
}

// Monatsanalyse schließen
function closeMonthAnalysis() {
    document.getElementById('monthAnalysisModal').style.display = 'none';
}

// Monatsanalyse als PDF herunterladen
function downloadMonthAnalysisPDF() {
    const data = window.currentMonthAnalysisData;
    if (!data) {
        alert('Keine Analysedaten verfügbar!');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });
    
    // Titel
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.text(`Monatsanalyse ${data.monthName} ${data.year}`, 105, 20, { align: 'center' });
    
    // Untertitel
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`Erstellt am: ${new Date().toLocaleDateString('de-DE')}`, 105, 27, { align: 'center' });
    
    // Tabellen-Header
    const startY = 40;
    let currentY = startY;
    
    doc.setFontSize(8);
    doc.setFont(undefined, 'bold');
    
    const colWidths = [50, 25, 15, 15, 15, 15, 15, 15, 15, 15];
    const colX = [15, 65, 90, 105, 120, 135, 150, 165, 180, 195];
    
    // Header
    doc.setFillColor(248, 249, 250);
    doc.rect(15, currentY - 5, 195, 8, 'F');
    
    const headers = ['Techniker', 'Team', 'ZR', 'X', 'I', 'W', 'K', 'U', 'Leer', 'Σ'];
    headers.forEach((header, i) => {
        const align = i < 2 ? 'left' : 'center';
        const x = i < 2 ? colX[i] : colX[i] + colWidths[i]/2;
        doc.text(header, x, currentY, { align });
    });
    
    currentY += 8;
    doc.setFont(undefined, 'normal');
    
    // Daten-Zeilen
    data.visibleTechniker.forEach((tech, index) => {
        const stats = data.techStats[tech.id];
        
        // Zebra-Streifen
        if (index % 2 === 0) {
            doc.setFillColor(255, 255, 255);
        } else {
            doc.setFillColor(248, 249, 250);
        }
        doc.rect(15, currentY - 5, 195, 6, 'F');
        
        // Techniker Name (gekürzt falls zu lang)
        let name = stats.name;
        if (name.length > 25) name = name.substring(0, 23) + '..';
        doc.text(name, colX[0], currentY);
        
        // Team (gekürzt)
        let team = stats.rsl;
        if (team.length > 12) team = team.substring(0, 10) + '..';
        doc.text(team, colX[1], currentY);
        
        // Zahlen zentriert
        doc.text(String(stats.ZR), colX[2] + colWidths[2]/2, currentY, { align: 'center' });
        doc.text(String(stats.X), colX[3] + colWidths[3]/2, currentY, { align: 'center' });
        doc.text(String(stats.I), colX[4] + colWidths[4]/2, currentY, { align: 'center' });
        doc.text(String(stats.W), colX[5] + colWidths[5]/2, currentY, { align: 'center' });
        doc.text(String(stats.K), colX[6] + colWidths[6]/2, currentY, { align: 'center' });
        doc.text(String(stats.U), colX[7] + colWidths[7]/2, currentY, { align: 'center' });
        doc.text(String(stats.empty), colX[8] + colWidths[8]/2, currentY, { align: 'center' });
        doc.text(String(stats.total), colX[9] + colWidths[9]/2, currentY, { align: 'center' });
        
        currentY += 6;
        
        // Seitenumbruch bei Bedarf
        if (currentY > 270) {
            doc.addPage();
            currentY = 20;
        }
    });
    
    // Summen-Zeile
    currentY += 2;
    doc.setFillColor(233, 236, 239);
    doc.rect(15, currentY - 5, 195, 8, 'F');
    doc.setFont(undefined, 'bold');
    
    doc.text('SUMME', colX[0], currentY);
    doc.text(String(data.totalZR), colX[2] + colWidths[2]/2, currentY, { align: 'center' });
    doc.text(String(data.totalX), colX[3] + colWidths[3]/2, currentY, { align: 'center' });
    doc.text(String(data.totalI), colX[4] + colWidths[4]/2, currentY, { align: 'center' });
    doc.text(String(data.totalW), colX[5] + colWidths[5]/2, currentY, { align: 'center' });
    doc.text(String(data.totalK), colX[6] + colWidths[6]/2, currentY, { align: 'center' });
    doc.text(String(data.totalU), colX[7] + colWidths[7]/2, currentY, { align: 'center' });
    doc.text(String(data.totalEmpty), colX[8] + colWidths[8]/2, currentY, { align: 'center' });
    doc.text(String(data.totalDays), colX[9] + colWidths[9]/2, currentY, { align: 'center' });
    
    // Tägliche Geräteabdeckung
    currentY += 15;
    
    // Prüfe ob noch Platz ist, sonst neue Seite
    if (currentY > 220) {
        doc.addPage();
        currentY = 20;
    }
    
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('Tägliche Geräteabdeckung', 15, currentY);
    
    currentY += 10;
    
    // Durchschnitt hervorheben
    doc.setFillColor(40, 167, 69);
    doc.rect(15, currentY - 5, 180, 10, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text(`Durchschnitt: ${data.avgCoverage}% (${data.dailyCoverage.length} Arbeitstage)`, 105, currentY + 2, { align: 'center' });
    doc.setTextColor(0, 0, 0);
    
    currentY += 12;
    
    // Coverage-Daten in Spalten
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    
    const itemsPerColumn = 10;
    const columnWidth = 60;
    let column = 0;
    let rowInColumn = 0;
    let startX = 15;
    let startYForCoverage = currentY;
    
    data.dailyCoverage.forEach((day, index) => {
        if (rowInColumn >= itemsPerColumn) {
            column++;
            rowInColumn = 0;
            
            // Neue Seite wenn keine Spalten mehr passen
            if (column >= 3) {
                doc.addPage();
                currentY = 20;
                startYForCoverage = currentY;
                column = 0;
            }
        }
        
        const x = startX + (column * columnWidth);
        const y = startYForCoverage + (rowInColumn * 6);
        
        // Datum
        doc.text(day.dateStr, x, y);
        
        // Coverage mit Farbe
        const coverageText = `${day.coveragePercent}%`;
        if (day.coveragePercent >= 80) {
            doc.setTextColor(40, 167, 69); // Grün
        } else if (day.coveragePercent >= 50) {
            doc.setTextColor(255, 193, 7); // Gelb/Orange
        } else {
            doc.setTextColor(220, 53, 69); // Rot
        }
        doc.text(coverageText, x + 45, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
        
        rowInColumn++;
    });
    
    // Legende
    currentY = startYForCoverage + Math.min(itemsPerColumn, data.dailyCoverage.length) * 6 + 5;
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.text('Legende: ZR = Bereitschaft | X = Abwesend | I = Installation | W = Wartung | K = Krank | U = Urlaub', 105, currentY, { align: 'center' });
    
    // Speichern
    doc.save(`Monatsanalyse_${data.monthName}_${data.year}.pdf`);
}

// Modal schließen beim Klick außerhalb
window.onclick = function(event) {
    const installModal = document.getElementById('installationAnalysisModal');
    const fullscreenModal = document.getElementById('fullscreenCalendarModal');
    const monthModal = document.getElementById('monthAnalysisModal');
    
    if (event.target === installModal) {
        closeInstallationAnalysis();
    }
    if (event.target === fullscreenModal) {
        closeFullscreenCalendar();
    }
    if (event.target === monthModal) {
        closeMonthAnalysis();
    }
}

// ===== END INSTALLATION PLANNING =====

// ===== END NOTIZEN-FENSTER =====

// ===== GOOGLE SHEETS INTEGRATION =====

let googleAccessToken = null;
let googleSheetId = null;
let googleSheetName = 'Sheet1';
let syncInterval = null;
let syncInProgress = false; // ✅ PERFORMANCE: Verhindert überlappende Syncs
let lastSyncHash = null; // ✅ PERFORMANCE: Change Detection
let isGoogleSheetsAuthenticated = false;

function initGoogleSheetsAPI() {
    console.log('🔧 Initializing Google Sheets API...');
    gapi.load('client', async () => {
        try {
            await gapi.client.init({
                discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
            });
            console.log('✅ Google Sheets API initialized');
        } catch (error) {
            console.error('❌ Error initializing API:', error);
        }
    });
}

function authenticateGoogleSheets() {
    // Read Client ID from localStorage (set via UI)
    const clientId = localStorage.getItem('googleClientId') || '';
    
    if (!clientId || clientId.trim() === '') {
        alert('⚠️ Google Client ID fehlt!\n\nBitte:\n1. Client ID eingeben (oben im Feld)\n2. "Client ID speichern" klicken\n3. Dann erneut "Mit Google verbinden" klicken');
        return;
    }
    
    // Get current URL for debugging
    const currentUrl = window.location.href;
    const currentOrigin = window.location.origin;
    
    console.log('🔐 OAuth Start:', {
        clientId: clientId.substring(0, 20) + '...',
        currentUrl: currentUrl,
        currentOrigin: currentOrigin
    });
    
    const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
        callback: (tokenResponse) => {
            if (tokenResponse && tokenResponse.access_token) {
                googleAccessToken = tokenResponse.access_token;
                gapi.client.setToken({access_token: googleAccessToken});
                isGoogleSheetsAuthenticated = true;
                
                updateGoogleSheetsStatus(true);
                document.getElementById('googleSheetsConfig').style.display = 'block';
                localStorage.setItem('googleSheetsConnected', 'true');
                
                alert('✅ Mit Google Sheets verbunden!');
            }
        },
        error_callback: (error) => {
            console.error('❌ OAuth error:', error);
            
            // Detailed error message
            let errorMsg = '❌ Verbindung fehlgeschlagen\n\n';
            
            if (error && error.type === 'popup_closed') {
                errorMsg += 'Popup wurde geschlossen.\n\nBitte erneut versuchen.';
            } else if (error && error.message) {
                errorMsg += 'Fehler: ' + error.message + '\n\n';
            } else {
                errorMsg += 'Fehler 400: invalid_request\n\n';
            }
            
            errorMsg += '🔍 Häufige Ursachen:\n\n';
            errorMsg += '1. PORT-PROBLEM:\n';
            errorMsg += '   Ihre App läuft auf: ' + currentOrigin + '\n';
            errorMsg += '   Ist dieser EXAKT in Google Cloud konfiguriert?\n\n';
            errorMsg += '2. Client ID falsch?\n';
            errorMsg += '   Gespeicherte ID: ' + clientId.substring(0, 30) + '...\n\n';
            errorMsg += '3. OAuth Consent Screen:\n';
            errorMsg += '   - Test users hinzugefügt?\n';
            errorMsg += '   - Scope "spreadsheets.readonly" ausgewählt?\n\n';
            errorMsg += '📋 Console öffnen (F12) für Details';
            
            alert(errorMsg);
        }
    });
    
    client.requestAccessToken();
}

function updateGoogleSheetsStatus(connected) {
    const statusDiv = document.getElementById('googleSheetsStatus');
    if (connected) {
        statusDiv.innerHTML = '<span style="color: #28a745;">✅ Verbunden</span>';
    } else {
        statusDiv.innerHTML = '<span style="color: #dc3545;">❌ Nicht verbunden</span>';
    }
}

// ✅ PERFORMANCE OPTIMIERT: Smart Load mit Change Detection
async function smartLoadGoogleSheetCalendar() {
    if (!isGoogleSheetsAuthenticated) {
        return;
    }
    
    if (syncInProgress) {
        console.log('⏸️ Sync bereits läuft, überspringe...');
        return;
    }
    
    syncInProgress = true;
    const startTime = performance.now();
    
    try {
        const sheetId = googleSheetId || document.getElementById('googleSheetId').value.trim();
        const sheetName = googleSheetName || document.getElementById('googleSheetName').value.trim() || 'Sheet1';
        
        if (!sheetId) {
            return;
        }
        
        const range = `${sheetName}!A1:ZZ1000`;
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: range,
        });
        
        const sheetData = response.result.values;
        
        if (!sheetData || sheetData.length === 0) {
            return;
        }
        
        // ✅ PERFORMANCE: Prüfe ob sich Daten geändert haben
        const currentHash = JSON.stringify(sheetData).length; // Simple hash
        
        if (lastSyncHash === currentHash) {
            console.log('✅ Keine Änderungen im Sheet, skip update');
            document.getElementById('lastSyncTime').style.display = 'block';
            updateLastSyncTime();
            return;
        }
        
        console.log(`📊 Loaded ${sheetData.length} rows from Google Sheet (Änderungen erkannt)`);
        const stats = await parseGoogleSheetCalendar(sheetData);
        
        lastSyncHash = currentHash;
        
        document.getElementById('lastSyncTime').style.display = 'block';
        updateLastSyncTime();
        
        const duration = performance.now() - startTime;
        logPerformance('syncOperations', duration);
        console.log(`✅ Sync erfolgreich: ${stats.entries} Einträge (${duration.toFixed(0)}ms)`);
        
    } catch (error) {
        console.error('❌ Sync Error:', error);
    } finally {
        syncInProgress = false;
    }
}

async function loadGoogleSheetCalendar() {
    if (!isGoogleSheetsAuthenticated) {
        alert('❌ Bitte erst mit Google verbinden');
        return;
    }
    
    const sheetId = document.getElementById('googleSheetId').value.trim();
    const sheetName = document.getElementById('googleSheetName').value.trim() || 'Sheet1';
    
    if (!sheetId) {
        alert('❌ Bitte Sheet-ID eingeben');
        return;
    }
    
    googleSheetId = sheetId;
    googleSheetName = sheetName;
    
    localStorage.setItem('googleSheetId', sheetId);
    localStorage.setItem('googleSheetName', sheetName);
    
    try {
        const range = `${sheetName}!A1:ZZ1000`;
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: sheetId,
            range: range,
        });
        
        const sheetData = response.result.values;
        
        if (!sheetData || sheetData.length === 0) {
            alert('❌ Sheet ist leer');
            return;
        }
        
        console.log(`📊 Loaded ${sheetData.length} rows from Google Sheet`);
        const stats = await parseGoogleSheetCalendar(sheetData);
        
        document.getElementById('lastSyncTime').style.display = 'block';
        updateLastSyncTime();
        
        if (stats) {
            alert(`✅ Kalender aktualisiert!\n\n📊 ${stats.days} Tage geladen\n👷 ${stats.technicians} Techniker\n📝 ${stats.entries} Status-Einträge\n\n💡 Öffnen Sie den Kalender um die Daten zu sehen`);
        }
        
    } catch (error) {
        console.error('❌ Error:', error);
        if (error.result && error.result.error) {
            const msg = error.result.error.message;
            if (msg.includes('not found')) {
                alert('❌ Sheet nicht gefunden - Sheet-ID prüfen');
            } else if (msg.includes('permission')) {
                alert('❌ Keine Berechtigung - Sheet teilen');
            } else {
                alert(`❌ ${msg}`);
            }
        } else {
            alert('❌ Fehler beim Laden');
        }
    }
}

async function parseGoogleSheetCalendar(sheetData) {
    if (sheetData.length < 2) {
        alert('❌ Zu wenige Zeilen (min. 2)');
        return;
    }
    
    const headerRow = sheetData[0];
    console.log('📊 Header:', headerRow);
    
    const codeMapping = {
        'ZR':'ZR', 'R':'ZR', 'I':'I', 'W':'W', 'K':'K', 'U':'U', 
        'X':'X', 'S':'X', 'E':'X', 'M':'X', 'Z':'X', 'AFZ':'U', '':''
    };
    
    const techMapping = {};
    
    for (let colIndex = 2; colIndex < headerRow.length; colIndex++) {
        const excelName = headerRow[colIndex];
        if (!excelName || typeof excelName !== 'string') continue;
        
        const excelNameClean = excelName.trim().toLowerCase();
        if (excelNameClean.length < 3 || !isNaN(parseInt(excelNameClean))) continue;
        
        const appTech = techniker.find(t => {
            const appNameLower = t.name.toLowerCase();
            if (appNameLower === excelNameClean) return true;
            if (excelNameClean.includes(appNameLower) || appNameLower.includes(excelNameClean)) return true;
            const excelLastName = excelNameClean.split(/\s+/).pop();
            const appLastName = appNameLower.split(/\s+/).pop();
            if (excelLastName === appLastName && excelLastName.length > 3) return true;
            return false;
        });
        
        if (appTech) {
            techMapping[colIndex] = appTech;
            console.log(`✅ "${excelName}" → "${appTech.name}"`);
        }
    }
    
    if (Object.keys(techMapping).length === 0) {
        alert('❌ Keine Techniker zugeordnet - Namen müssen übereinstimmen');
        return;
    }
    
    console.log(`📋 ${Object.keys(techMapping).length} Techniker zugeordnet`);
    
    let importedDays = 0;
    let importedEntries = 0;
    
    for (let rowIndex = 1; rowIndex < sheetData.length; rowIndex++) {
        const row = sheetData[rowIndex];
        
        // Try column B first (index 1), then column A (index 0) if B is empty
        let datumCell = row[1];
        let technicianStartCol = 2; // Technicians start at column C by default
        
        if (!datumCell || datumCell.toString().trim() === '') {
            // Try column A if B is empty
            datumCell = row[0];
            technicianStartCol = 1; // Technicians start at column B if date is in A
            console.log('⚠️ Spalte B leer, versuche Spalte A für Datum');
        }
        
        if (!datumCell) continue;
        
        let date;
        if (typeof datumCell === 'string') {
            // Remove weekday prefix (e.g. "Mo. ", "Di. ", etc.)
            let cleanedDate = datumCell.trim();
            
            // Remove weekday like "Mo. ", "Di. ", "Mi. ", etc.
            cleanedDate = cleanedDate.replace(/^[A-Za-z]{2}\.\s*/, '');
            
            console.log(`🔍 Parsing date: "${datumCell}" → cleaned: "${cleanedDate}"`);
            
            // Parse date: DD.MM.YY or DD.MM.YYYY
            const parts = cleanedDate.split('.');
            if (parts.length === 3) {
                let day = parseInt(parts[0].trim());
                let month = parseInt(parts[1].trim()) - 1; // JavaScript months are 0-indexed
                let year = parseInt(parts[2].trim());
                
                // Convert 2-digit year to 4-digit (25 → 2025)
                if (year < 100) {
                    year += 2000;
                }
                
                date = new Date(year, month, day);
                console.log(`📅 Parsed: Day=${day}, Month=${month+1}, Year=${year} → Date=${date.toLocaleDateString('de-DE')}`);
            }
        }
        
        if (!date || isNaN(date.getTime())) {
            console.log(`⚠️ Could not parse date: "${datumCell}"`);
            continue;
        }
        
        const dateStr = formatDate(date);
        importedDays++;
        
        // Process technician columns (adjust based on where date was found)
        for (const [colIndex, tech] of Object.entries(techMapping)) {
            const statusRaw = row[colIndex];
            if (!statusRaw) continue;
            
            const statusClean = statusRaw.toString().trim().toUpperCase();
            const mappedStatus = codeMapping[statusClean] || statusClean;
            
            if (mappedStatus && mappedStatus !== '') {
                setScheduleStatus(tech.id, dateStr, mappedStatus);
                importedEntries++;
            }
        }
    }
    
    console.log(`✅ Imported ${importedDays} days, ${importedEntries} status entries`);
    console.log(`📊 ${Object.keys(techMapping).length} Techniker × ${importedDays} Tage = ${importedEntries} Einträge`);
    
    // Update both calendars
    renderScheduleCalendar();
    
    // Also update fullscreen calendar if open
    if (document.getElementById('fullscreenCalendarModal') && 
        document.getElementById('fullscreenCalendarModal').style.display === 'block') {
        console.log('🔄 Updating fullscreen calendar...');
        renderFullscreenCalendar();
    }
    
    updateMapForSelectedDate();
    
    // Return statistics
    return {
        days: importedDays,
        entries: importedEntries,
        technicians: Object.keys(techMapping).length
    };
}

// ✅ PERFORMANCE OPTIMIERT: Auto-Sync Funktionen
function toggleAutoSync() {
    const checkbox = document.getElementById('autoSyncToggle');
    if (checkbox.checked) {
        startAutoSync();
    } else {
        stopAutoSync();
    }
}

function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    
    // ✅ PERFORMANCE: 60s statt 30s, mit Overlap-Protection
    syncInterval = setInterval(async () => {
        if (syncInProgress) {
            console.log('⏸️ Sync bereits läuft, überspringe...');
            return;
        }
        
        console.log('🔄 Auto-syncing...');
        await smartLoadGoogleSheetCalendar();
    }, 60000); // ✅ 60 Sekunden statt 30
    
    console.log('🔄 Auto-sync started (60s)');
}

function stopAutoSync() {
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    syncInProgress = false; // Reset flag
}

function updateLastSyncTime() {
    const now = new Date();
    document.getElementById('lastSyncTimestamp').textContent = now.toLocaleTimeString('de-DE');
}

// Save Client ID
function saveGoogleClientId() {
    const clientIdInput = document.getElementById('googleClientIdInput');
    const clientId = clientIdInput.value.trim();
    
    if (!clientId || clientId === '') {
        alert('❌ Bitte Client ID eingeben');
        return;
    }
    
    // Save to localStorage
    localStorage.setItem('googleClientId', clientId);
    
    alert('✅ Client ID gespeichert!\n\nJetzt können Sie "Mit Google verbinden" klicken.');
}

document.addEventListener('DOMContentLoaded', function() {
    if (typeof gapi !== 'undefined') {
        initGoogleSheetsAPI();
    }
    
    // Save Client ID button
    const saveClientIdBtn = document.getElementById('saveClientIdBtn');
    if (saveClientIdBtn) {
        saveClientIdBtn.addEventListener('click', saveGoogleClientId);
    }
    
    const connectBtn = document.getElementById('connectGoogleSheetsBtn');
    if (connectBtn) {
        connectBtn.addEventListener('click', authenticateGoogleSheets);
    }
    
    const loadBtn = document.getElementById('loadGoogleSheetBtn');
    if (loadBtn) {
        loadBtn.addEventListener('click', loadGoogleSheetCalendar);
    }
    
    const autoSyncToggle = document.getElementById('autoSyncToggle');
    if (autoSyncToggle) {
        autoSyncToggle.addEventListener('change', toggleAutoSync);
    }
    
    // Load saved values
    const savedClientId = localStorage.getItem('googleClientId');
    const savedSheetId = localStorage.getItem('googleSheetId');
    const savedSheetName = localStorage.getItem('googleSheetName');
    
    if (savedClientId) {
        const clientIdInput = document.getElementById('googleClientIdInput');
        if (clientIdInput) clientIdInput.value = savedClientId;
    }
    if (savedSheetId) {
        const sheetIdInput = document.getElementById('googleSheetId');
        if (sheetIdInput) sheetIdInput.value = savedSheetId;
    }
    if (savedSheetName) {
        const sheetNameInput = document.getElementById('googleSheetName');
        if (sheetNameInput) sheetNameInput.value = savedSheetName;
    }
});

// ===== END GOOGLE SHEETS INTEGRATION =====

// ===== CUSTOMER ASSIGNMENT SYSTEM =====

// Toggle Assignment Mode
function toggleAssignmentMode() {
    assignmentMode = !assignmentMode;
    
    console.log(`${assignmentMode ? '👥 Assignment-Modus aktiviert' : '📋 Assignment-Modus deaktiviert'}`);
    
    // Update UI
    const assignmentPanel = document.getElementById('assignmentPanel');
    const assignmentBtn = document.getElementById('assignmentModeBtn');
    
    if (assignmentMode) {
        assignmentPanel.style.display = 'flex';
        assignmentBtn.classList.add('active');
        assignmentBtn.innerHTML = '👥 Zuweisung aktiv';
        
        // Initialize drag functionality
        initAssignmentPanelDrag();
        
        // Initialize header collapse state
        initAssignmentHeaderState();
        
        // Refresh assignment panel
        refreshAssignmentPanel();
        
        // Show assignment lines on map
        updateAssignmentLines();
    } else {
        assignmentPanel.style.display = 'none';
        assignmentBtn.classList.remove('active');
        assignmentBtn.innerHTML = '👥 Kunden zuweisen';
        
        // Clear selection
        selectedTechnicianForAssignment = null;
        
        // Restore all isochrones
        showAllIsochrones();
        
        // Hide assignment lines
        clearAssignmentLines();
    }
}

// Toggle assignment header (statistics and actions)
function toggleAssignmentHeader() {
    const content = document.getElementById('assignmentCollapsibleContent');
    const icon = document.getElementById('assignmentCollapseIcon');
    
    if (content.style.display === 'none') {
        // Expand
        content.style.display = 'block';
        icon.textContent = '▼';
        // Save state
        localStorage.setItem('assignmentHeaderCollapsed', 'false');
    } else {
        // Collapse
        content.style.display = 'none';
        icon.textContent = '▶';
        // Save state
        localStorage.setItem('assignmentHeaderCollapsed', 'true');
    }
}

// Initialize assignment header state from localStorage
function initAssignmentHeaderState() {
    const collapsed = localStorage.getItem('assignmentHeaderCollapsed') === 'true';
    
    if (collapsed) {
        const content = document.getElementById('assignmentCollapsibleContent');
        const icon = document.getElementById('assignmentCollapseIcon');
        
        if (content && icon) {
            content.style.display = 'none';
            icon.textContent = '▶';
        }
    }
}

// Initialize drag functionality for assignment panel
function initAssignmentPanelDrag() {
    const panel = document.getElementById('assignmentPanel');
    const titlebar = document.getElementById('assignmentPanelTitlebar');
    const resizeHandle = panel.querySelector('.resize-handle');
    
    if (!titlebar || panel.dataset.dragInitialized === 'true') return;
    
    // === DRAG FUNCTIONALITY ===
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;
    
    titlebar.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    
    function dragStart(e) {
        // Don't drag if clicking on close button
        if (e.target.classList.contains('assignment-btn-close')) return;
        
        initialX = e.clientX;
        initialY = e.clientY;
        
        // Get current position
        const rect = panel.getBoundingClientRect();
        currentX = rect.left;
        currentY = rect.top;
        
        isDragging = true;
        panel.classList.add('dragging');
        
        // Remove transform and set absolute position
        panel.style.transform = 'none';
        panel.style.left = currentX + 'px';
        panel.style.top = currentY + 'px';
    }
    
    function drag(e) {
        if (!isDragging) return;
        
        e.preventDefault();
        
        const dx = e.clientX - initialX;
        const dy = e.clientY - initialY;
        
        const newX = currentX + dx;
        const newY = currentY + dy;
        
        panel.style.left = newX + 'px';
        panel.style.top = newY + 'px';
    }
    
    function dragEnd(e) {
        if (isDragging) {
            isDragging = false;
            panel.classList.remove('dragging');
        }
    }
    
    // === RESIZE FUNCTIONALITY ===
    if (resizeHandle) {
        let isResizing = false;
        let startX, startY, startWidth, startHeight;
        
        resizeHandle.addEventListener('mousedown', resizeStart);
        document.addEventListener('mousemove', resize);
        document.addEventListener('mouseup', resizeEnd);
        
        function resizeStart(e) {
            e.preventDefault();
            e.stopPropagation();
            
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = panel.getBoundingClientRect();
            startWidth = rect.width;
            startHeight = rect.height;
            
            panel.style.transition = 'none';
        }
        
        function resize(e) {
            if (!isResizing) return;
            
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            const newWidth = Math.max(600, Math.min(startWidth + dx, window.innerWidth * 0.95));
            const newHeight = Math.max(400, Math.min(startHeight + dy, window.innerHeight * 0.95));
            
            panel.style.width = newWidth + 'px';
            panel.style.height = newHeight + 'px';
        }
        
        function resizeEnd() {
            if (isResizing) {
                isResizing = false;
                panel.style.transition = '';
            }
        }
    }
    
    panel.dataset.dragInitialized = 'true';
}

// Refresh Assignment Panel
function refreshAssignmentPanel() {
    if (!assignmentMode) return;
    
    const techniciansList = document.getElementById('assignmentTechniciansList');
    const customersList = document.getElementById('assignmentCustomersList');
    
    // Clear lists
    techniciansList.innerHTML = '';
    customersList.innerHTML = '';
    
    // Filter nur sichtbare Techniker und sortiere alphabetisch
    const sortedTechnicians = techniker
        .filter(t => t.visible !== false)
        .sort((a, b) => a.name.localeCompare(b.name));
    
    // Wenn ausgewählter Techniker nicht mehr sichtbar ist, Auswahl aufheben
    if (selectedTechnicianForAssignment) {
        const selectedTech = techniker.find(t => t.id === selectedTechnicianForAssignment);
        if (!selectedTech || selectedTech.visible === false) {
            console.log('🔄 Ausgewählter Techniker nicht mehr sichtbar - Auswahl aufgehoben');
            selectedTechnicianForAssignment = null;
            showAllIsochrones();
        }
    }
    
    // Render technicians
    sortedTechnicians.forEach(tech => {
        // Count assigned devices and calculate total weight (nur sichtbare Kunden)
        let assignedDevicesCount = 0;
        let assignedCustomersCount = 0;
        let totalWeight = 0;
        
        kunden.filter(k => k.visible !== false).forEach(kunde => {
            if (kunde.deviceAssignments) {
                let customerHasAssignment = false;
                Object.entries(kunde.deviceAssignments).forEach(([deviceKey, techId]) => {
                    if (techId === tech.id) {
                        // deviceKey is in format "DeviceName_index" (e.g., "Pro_0")
                        // Extract the device name
                        const deviceName = deviceKey.substring(0, deviceKey.lastIndexOf('_'));
                        
                        // Count this device
                        assignedDevicesCount++;
                        customerHasAssignment = true;
                        
                        // Add weight for this device
                        const weight = deviceWeights[deviceName] || 1.0;
                        totalWeight += weight;
                    }
                });
                if (customerHasAssignment) assignedCustomersCount++;
            }
        });
        
        const isSelected = selectedTechnicianForAssignment === tech.id;
        
        const item = document.createElement('div');
        item.className = `assignment-tech-item ${isSelected ? 'selected' : ''}`;
        item.innerHTML = `
            <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 13px; color: #2c3e50;">${tech.name}</div>
                <div style="font-size: 11px; color: #7f8c8d; margin-top: 2px;">
                    ${assignedDevicesCount} ${assignedDevicesCount === 1 ? 'Gerät' : 'Geräte'} bei ${assignedCustomersCount} ${assignedCustomersCount === 1 ? 'Kunde' : 'Kunden'}
                </div>
                <div style="font-size: 11px; color: #3498db; margin-top: 2px; font-weight: 600;">
                    ⚖️ Gewichtung: ${totalWeight.toFixed(1)}
                </div>
                ${tech.skills && tech.skills.length > 0 ? 
                    `<div style="font-size: 10px; color: #667eea; margin-top: 2px;">🎯 ${tech.skills.join(', ')}</div>` 
                    : ''}
            </div>
            <button class="btn-assignment-select ${isSelected ? 'selected' : ''}" 
                    onclick="selectTechnicianForAssignment(${tech.id})">
                ${isSelected ? '✓' : '→'}
            </button>
        `;
        techniciansList.appendChild(item);
    });
    
    // Update customer statistics
    updateAssignmentStats();
    
    // Render customers
    renderAssignmentCustomers();
}

// Select Technician for Assignment
function selectTechnicianForAssignment(techId) {
    if (selectedTechnicianForAssignment === techId) {
        // Deselect
        selectedTechnicianForAssignment = null;
        console.log('👤 Techniker-Auswahl aufgehoben');
        
        // Show all isochrones again
        showAllIsochrones();
    } else {
        // Select
        selectedTechnicianForAssignment = techId;
        const tech = techniker.find(t => t.id === techId);
        console.log(`👤 Techniker ausgewählt: ${tech ? tech.name : 'Unbekannt'} (ID: ${techId})`);
        
        // Debug: Check if isochrone exists
        const hasIsochrone = isochroneGeoJSON.find(iso => iso.techId === techId);
        if (hasIsochrone) {
            console.log(`   ✅ Isochrone vorhanden für ${tech.name}`);
        } else {
            console.warn(`   ⚠️ KEINE Isochrone für ${tech.name}! Bitte "Isochronen laden" klicken.`);
        }
        
        // Show only this technician's isochrone
        showOnlyTechnicianIsochrone(techId);
    }
    
    refreshAssignmentPanel();
    updateAssignmentLines();
}

// Show only selected technician's isochrone
function showOnlyTechnicianIsochrone(techId) {
    console.log(`🗺️ Zeige nur Isochrone von Techniker ID: ${techId}`);
    
    isochroneLayers.forEach(isoLayer => {
        if (isoLayer.techId === techId) {
            // Show this technician's isochrone
            if (!map.hasLayer(isoLayer.layer)) {
                map.addLayer(isoLayer.layer);
            }
            // Highlight it
            isoLayer.layer.setStyle({
                weight: 3,
                opacity: 0.7,
                fillOpacity: 0.15
            });
        } else {
            // Hide other isochrones
            if (map.hasLayer(isoLayer.layer)) {
                map.removeLayer(isoLayer.layer);
            }
        }
    });
}

// Show all isochrones (when deselecting technician)
function showAllIsochrones() {
    console.log('🗺️ Zeige alle Isochronen');
    
    isochroneLayers.forEach(isoLayer => {
        if (!map.hasLayer(isoLayer.layer)) {
            map.addLayer(isoLayer.layer);
        }
        // Reset to normal style
        isoLayer.layer.setStyle({
            weight: 2,
            opacity: 0.5,
            fillOpacity: 0.1
        });
    });
}

// Filter assignment customers by search term
function filterAssignmentCustomers() {
    renderAssignmentCustomers();
}

// Render customers in assignment panel
function renderAssignmentCustomers() {
    const customersList = document.getElementById('assignmentCustomersList');
    customersList.innerHTML = '';
    
    // Filter nur sichtbare Kunden (respektiere globale Filter)
    let filteredCustomers = kunden.filter(k => k.visible !== false);
    
    // Apply search filter
    const searchInput = document.getElementById('assignmentCustomerSearch');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    
    if (searchTerm) {
        filteredCustomers = filteredCustomers.filter(k => 
            k.name.toLowerCase().includes(searchTerm) ||
            (k.ort && k.ort.toLowerCase().includes(searchTerm)) ||
            (k.plz && k.plz.toString().includes(searchTerm))
        );
    }
    
    // Only apply assignment filter (assigned/unassigned/partial/assignedToSelected)
    if (assignmentFilter === 'assigned') {
        filteredCustomers = filteredCustomers.filter(k => 
            k.deviceAssignments && Object.keys(k.deviceAssignments).length > 0
        );
    } else if (assignmentFilter === 'unassigned') {
        filteredCustomers = filteredCustomers.filter(k => 
            !k.deviceAssignments || Object.keys(k.deviceAssignments).length === 0
        );
    } else if (assignmentFilter === 'partial') {
        filteredCustomers = filteredCustomers.filter(k => {
            if (!k.deviceAssignments || !k.instrumentLines) return false;
            const uniqueDevices = [...new Set(k.instrumentLines)];
            const assignedDevices = Object.keys(k.deviceAssignments);
            return assignedDevices.length > 0 && assignedDevices.length < uniqueDevices.length;
        });
    } else if (assignmentFilter === 'assignedToSelected') {
        // Show only customers with at least one device assigned to selected technician
        if (!selectedTechnicianForAssignment) {
            // No technician selected - show nothing or all
            filteredCustomers = [];
        } else {
            filteredCustomers = filteredCustomers.filter(k => {
                if (!k.deviceAssignments) return false;
                // Check if any device is assigned to selected technician
                return Object.values(k.deviceAssignments).some(techId => 
                    techId === selectedTechnicianForAssignment
                );
            });
        }
    }
    
    // Calculate coverage status for each customer (for sorting)
    const customersWithCoverage = filteredCustomers.map(kunde => {
        let coverageStatus = 'not-covered';
        let coveragePriority = 3; // 1=fully, 2=partially, 3=not
        
        if (selectedTechnicianForAssignment) {
            const selectedTech = techniker.find(t => t.id === selectedTechnicianForAssignment);
            
            if (selectedTech) {
                const isInReach = isCustomerInTechnicianReach(kunde, selectedTech);
                
                if (isInReach) {
                    const uniqueDevices = [...new Set(kunde.instrumentLines || [])];
                    const techSkills = selectedTech.skills || [];
                    
                    let coveredDevices = uniqueDevices.filter(device => 
                        techSkills.length === 0 || 
                        techSkills.some(skill => 
                            device.toLowerCase().includes(skill.toLowerCase()) ||
                            skill.toLowerCase().includes(device.toLowerCase())
                        )
                    ).length;
                    
                    if (coveredDevices === uniqueDevices.length && coveredDevices > 0) {
                        coverageStatus = 'fully-covered';
                        coveragePriority = 1;
                    } else if (coveredDevices > 0) {
                        coverageStatus = 'partially-covered';
                        coveragePriority = 2;
                    }
                }
            }
        }
        
        return { kunde, coverageStatus, coveragePriority };
    });
    
    // Sort: 1. By coverage priority (fully → partially → not), 2. By name
    customersWithCoverage.sort((a, b) => {
        if (a.coveragePriority !== b.coveragePriority) {
            return a.coveragePriority - b.coveragePriority;
        }
        return a.kunde.name.localeCompare(b.kunde.name);
    });
    
    // Render customers
    customersWithCoverage.forEach(({ kunde, coverageStatus }) => {
        // Initialize deviceAssignments if not present
        if (!kunde.deviceAssignments) {
            kunde.deviceAssignments = {};
        }
        
        // Get coverage display info based on coverageStatus
        let coverageIcon = '⚪';
        let coverageText = 'Keine Abdeckung';
        let coverageColor = '#95a5a6';
        
        if (coverageStatus === 'fully-covered') {
            coverageIcon = '🟢';
            coverageColor = '#27ae60';
        } else if (coverageStatus === 'partially-covered') {
            coverageIcon = '🟡';
            coverageColor = '#f1c40f';
        } else if (coverageStatus === 'not-covered') {
            coverageIcon = '🔴';
            coverageColor = '#e74c3c';
        }
        
        if (selectedTechnicianForAssignment) {
            const selectedTech = techniker.find(t => t.id === selectedTechnicianForAssignment);
            
            if (selectedTech) {
                const isInReach = isCustomerInTechnicianReach(kunde, selectedTech);
                
                if (!isInReach) {
                    coverageText = `Außerhalb Reichweite von ${selectedTech.name}`;
                } else {
                    const uniqueDevices = [...new Set(kunde.instrumentLines || [])];
                    const techSkills = selectedTech.skills || [];
                    
                    let coveredDevices = uniqueDevices.filter(device => 
                        techSkills.length === 0 || 
                        techSkills.some(skill => 
                            device.toLowerCase().includes(skill.toLowerCase()) ||
                            skill.toLowerCase().includes(device.toLowerCase())
                        )
                    ).length;
                    
                    if (coveredDevices === 0) {
                        coverageText = `In Reichweite, aber keine Skills (0/${uniqueDevices.length})`;
                    } else if (coveredDevices === uniqueDevices.length) {
                        coverageText = `Vollständig abgedeckt (${coveredDevices}/${uniqueDevices.length})`;
                    } else {
                        coverageText = `Teilweise abgedeckt (${coveredDevices}/${uniqueDevices.length})`;
                    }
                }
            }
        } else {
            // No technician selected: show general team coverage
            coverageIcon = kunde.covered ? '✅' : '⚠️';
            coverageText = kunde.covered ? 'Team-abgedeckt' : 'Team nicht abgedeckt';
            coverageColor = kunde.covered ? '#27ae60' : '#e74c3c';
        }
        
        const item = document.createElement('div');
        item.className = `assignment-customer-item coverage-${coverageStatus}`;
        
        // Build device list HTML - show each device instance separately
        let devicesHTML = '';
        
        if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) {
            devicesHTML = '<div style="color: #95a5a6; font-size: 11px; padding: 8px;">Keine Geräte</div>';
        } else {
            devicesHTML = '<div style="margin-top: 8px;">';
            
            // Group devices by type to track indices
            const deviceIndices = {}; // { "Pro": 0, "X-Plore": 0, ... }
            
            kunde.instrumentLines.forEach((device, arrayIndex) => {
                const trimmedDevice = device.trim();
                if (!trimmedDevice) return;
                
                // Track index for this device type
                if (!deviceIndices[trimmedDevice]) {
                    deviceIndices[trimmedDevice] = 0;
                }
                const deviceIndex = deviceIndices[trimmedDevice];
                deviceIndices[trimmedDevice]++;
                
                // Create device key: "deviceType_index"
                const deviceKey = `${trimmedDevice}_${deviceIndex}`;
                
                // Check assignment
                const assignedTechId = kunde.deviceAssignments ? kunde.deviceAssignments[deviceKey] : null;
                const assignedTech = assignedTechId ? techniker.find(t => t.id === assignedTechId) : null;
                
                const isAssignedToSelected = selectedTechnicianForAssignment && assignedTechId === selectedTechnicianForAssignment;
                const isAssigned = assignedTechId !== undefined && assignedTechId !== null;
                
                // Check if selected technician has the skill for this device
                let canAssign = true;
                let warningReason = '';
                
                if (selectedTechnicianForAssignment) {
                    const selectedTech = techniker.find(t => t.id === selectedTechnicianForAssignment);
                    
                    if (selectedTech) {
                        // Check reach first
                        const isInReach = isCustomerInTechnicianReach(kunde, selectedTech);
                        
                        if (!isInReach) {
                            canAssign = false;
                            warningReason = 'Außerhalb Reichweite';
                        } else if (selectedTech.skills && selectedTech.skills.length > 0) {
                            // Check skills only if in reach
                            const hasSkill = selectedTech.skills.some(skill => 
                                trimmedDevice.toLowerCase().includes(skill.toLowerCase()) ||
                                skill.toLowerCase().includes(trimmedDevice.toLowerCase())
                            );
                            
                            if (!hasSkill) {
                                canAssign = false;
                                warningReason = 'Skill fehlt';
                            }
                        }
                    }
                }
                
                // Count total devices of this type
                const totalOfType = kunde.instrumentLines.filter(d => d.trim() === trimmedDevice).length;
                const displayText = totalOfType > 1 ? `${trimmedDevice} #${deviceIndex + 1}` : trimmedDevice;
                
                devicesHTML += `
                    <div style="display: flex; align-items: center; gap: 8px; padding: 6px; background: ${isAssignedToSelected ? '#ebf5fb' : (isAssigned ? '#f8f9fa' : 'white')}; border-radius: 6px; margin-bottom: 4px; border: 1px solid ${isAssignedToSelected ? '#3498db' : '#e9ecef'};">
                        <span class="instrument-tag" style="flex: 1; margin: 0;">${displayText}</span>
                        ${isAssigned ? 
                            `<span style="font-size: 10px; color: #27ae60; font-weight: 600;">✓ ${assignedTech ? assignedTech.name : 'Zugewiesen'}</span>`
                            : '<span style="font-size: 10px; color: #95a5a6;">Nicht zugewiesen</span>'
                        }
                        ${selectedTechnicianForAssignment ? 
                            `<button class="btn-device-assign ${isAssignedToSelected ? 'assigned' : ''} ${!canAssign ? 'warning' : ''}" 
                                    onclick="toggleDeviceAssignment(${kunde.id}, '${deviceKey.replace(/'/g, "\\'")}')"
                                    title="${canAssign ? 'Zuweisen' : 'Manuell zuweisen (⚠️ ' + warningReason + ')'}">
                                ${isAssignedToSelected ? '✓' : '+'}${!canAssign ? ' ⚠️' : ''}
                            </button>` 
                            : ''}
                    </div>
                `;
            });
            
            devicesHTML += '</div>';
        }
        
        // Calculate total device weight for this customer
        const totalWeight = calculateCustomerDeviceWeight(kunde);
        const weightDisplay = totalWeight > 0 ? ` <span style="color: #95a5a6; font-size: 11px; font-weight: 400;">(${totalWeight.toFixed(1)})</span>` : '';
        
        item.innerHTML = `
            <div style="padding: 12px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-left: 4px solid ${coverageColor};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; font-size: 13px; color: #2c3e50; margin-bottom: 4px;">
                            ${kunde.name}${weightDisplay} <span title="${coverageText}" style="font-size: 16px;">${coverageIcon}</span>
                        </div>
                        ${selectedTechnicianForAssignment ? 
                            `<div style="font-size: 10px; color: ${coverageColor}; font-weight: 500;">${coverageText}</div>` 
                            : ''}
                    </div>
                    <button class="btn-assignment-action" 
                            onclick="zoomToLocation(${kunde.lat}, ${kunde.lng})"
                            title="Zoom">
                        🎯
                    </button>
                </div>
                ${devicesHTML}
            </div>
        `;
        
        customersList.appendChild(item);
    });
    
    // Show coverage summary when technician is selected
    if (selectedTechnicianForAssignment) {
        const fullyCovered = filteredCustomers.filter(k => {
            if (!k.deviceAssignments) k.deviceAssignments = {};
            const item = document.querySelector(`.assignment-customer-item.coverage-fully-covered`);
            return item !== null;
        });
        
        // Count by coverage status
        let fullyCount = 0;
        let partialCount = 0;
        let notCount = 0;
        
        filteredCustomers.forEach(k => {
            const uniqueDevices = [...new Set(k.instrumentLines || [])];
            const selectedTech = techniker.find(t => t.id === selectedTechnicianForAssignment);
            
            if (selectedTech) {
                const isInReach = isCustomerInTechnicianReach(k, selectedTech);
                if (!isInReach) {
                    notCount++;
                } else {
                    const techSkills = selectedTech.skills || [];
                    let coveredDevices = uniqueDevices.filter(device => 
                        techSkills.length === 0 || 
                        techSkills.some(skill => 
                            device.toLowerCase().includes(skill.toLowerCase()) ||
                            skill.toLowerCase().includes(device.toLowerCase())
                        )
                    ).length;
                    
                    if (coveredDevices === 0) {
                        notCount++;
                    } else if (coveredDevices === uniqueDevices.length) {
                        fullyCount++;
                    } else {
                        partialCount++;
                    }
                }
            }
        });
        
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'padding: 12px; text-align: center; font-size: 11px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 8px; margin: 10px; border: 1px solid #dee2e6;';
        infoDiv.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px; color: #2c3e50;">Abdeckung durch ausgewählten Techniker:</div>
            <div style="display: flex; justify-content: space-around; gap: 10px;">
                <div><span style="color: #27ae60;">🟢 ${fullyCount}</span> Vollständig</div>
                <div><span style="color: #f1c40f;">🟡 ${partialCount}</span> Teilweise</div>
                <div><span style="color: #e74c3c;">🔴 ${notCount}</span> Nicht abgedeckt</div>
            </div>
        `;
        customersList.insertBefore(infoDiv, customersList.firstChild);
    }
}

// Toggle device assignment (new function for device-based assignments)
function toggleDeviceAssignment(customerId, deviceKey) {
    if (!selectedTechnicianForAssignment) {
        alert('⚠️ Bitte wählen Sie zuerst einen Techniker aus');
        return;
    }
    
    const kunde = kunden.find(k => k.id === customerId);
    if (!kunde) return;
    
    // Initialize if not present
    if (!kunde.deviceAssignments) {
        kunde.deviceAssignments = {};
    }
    
    // Extract device type and index from key (e.g., "Pro_0" -> "Pro #1")
    const parts = deviceKey.split('_');
    const deviceType = parts.slice(0, -1).join('_'); // Handle device names with underscores
    const deviceIndex = parseInt(parts[parts.length - 1]);
    const displayName = `${deviceType} #${deviceIndex + 1}`;
    
    // Toggle assignment
    if (kunde.deviceAssignments[deviceKey] === selectedTechnicianForAssignment) {
        // Remove assignment
        delete kunde.deviceAssignments[deviceKey];
        console.log(`➖ Gerät "${displayName}" bei Kunde "${kunde.name}" entfernt`);
    } else {
        // Add/change assignment
        kunde.deviceAssignments[deviceKey] = selectedTechnicianForAssignment;
        const tech = techniker.find(t => t.id === selectedTechnicianForAssignment);
        console.log(`➕ Gerät "${displayName}" bei Kunde "${kunde.name}" → ${tech ? tech.name : 'Techniker'} zugewiesen`);
    }
    
    // Save and refresh
    saveToLocalStorage();
    refreshAssignmentPanel();
    updateAssignmentLines();
}

// Helper function: Check if customer is within technician's reach
function isCustomerInTechnicianReach(kunde, tech) {
    // Find the technician's isochrone data (stored as techId, not technikerId!)
    const techIsochrone = isochroneGeoJSON.find(iso => iso.techId === tech.id);
    
    if (!techIsochrone || !techIsochrone.feature) {
        // No isochrone data available for this specific technician
        console.log(`⚠️ Keine Isochrone für Techniker ${tech.name} (ID: ${tech.id})`);
        
        // If no isochrones are loaded at all, assume reachable
        if (isochroneGeoJSON.length === 0) {
            return true;
        }
        
        // If other technicians have isochrones but this one doesn't, assume NOT reachable
        return false;
    }
    
    try {
        // Use the existing isPointInPolygon function (same as in coverage check)
        const isInside = isPointInPolygon(kunde.lng, kunde.lat, techIsochrone.feature.geometry);
        return isInside;
    } catch (error) {
        console.warn(`Coverage-Check Fehler für ${kunde.name} bei ${tech.name}:`, error);
        return false; // Bei Fehler als NICHT erreichbar annehmen (sicherer)
    }
}


// Set assignment filter
function setAssignmentFilter(filter) {
    assignmentFilter = filter;
    
    // Update button states
    document.querySelectorAll('.assignment-filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Handle the ID construction for camelCase filter names
    let filterId;
    if (filter === 'assignedToSelected') {
        filterId = 'assignmentFilterAssignedToSelected';
    } else {
        filterId = `assignmentFilter${filter.charAt(0).toUpperCase() + filter.slice(1)}`;
    }
    
    const filterBtn = document.getElementById(filterId);
    if (filterBtn) {
        filterBtn.classList.add('active');
    }
    
    // Refresh customer list
    renderAssignmentCustomers();
}

// Update assignment statistics
function updateAssignmentStats() {
    // Nur sichtbare Kunden berücksichtigen
    const visibleCustomers = kunden.filter(k => k.visible !== false);
    const totalCustomers = visibleCustomers.length;
    
    let fullyAssignedCustomers = 0;
    let partiallyAssignedCustomers = 0;
    let unassignedCustomers = 0;
    
    visibleCustomers.forEach(kunde => {
        const uniqueDevices = [...new Set(kunde.instrumentLines || [])];
        const assignedDevices = kunde.deviceAssignments ? Object.keys(kunde.deviceAssignments).length : 0;
        
        if (assignedDevices === 0) {
            unassignedCustomers++;
        } else if (assignedDevices < uniqueDevices.length) {
            partiallyAssignedCustomers++;
        } else {
            fullyAssignedCustomers++;
        }
    });
    
    const assignedCustomers = fullyAssignedCustomers + partiallyAssignedCustomers;
    
    document.getElementById('assignmentStatsTotal').textContent = totalCustomers;
    document.getElementById('assignmentStatsAssigned').textContent = assignedCustomers;
    document.getElementById('assignmentStatsUnassigned').textContent = unassignedCustomers;
}

// Update assignment lines on map
function updateAssignmentLines() {
    // Clear existing lines
    clearAssignmentLines();
    
    if (!assignmentMode) return;
    
    // Build kunde-technician relationships (nur sichtbare Kunden)
    const relationships = new Map(); // key: "kundeId-techId", value: { kunde, tech, deviceCount }
    
    kunden.filter(k => k.visible !== false).forEach(kunde => {
        if (!kunde.deviceAssignments) return;
        
        Object.entries(kunde.deviceAssignments).forEach(([deviceKey, techId]) => {
            const key = `${kunde.id}-${techId}`;
            if (!relationships.has(key)) {
                relationships.set(key, {
                    kunde: kunde,
                    techId: techId,
                    deviceCount: 0
                });
            }
            
            // Each deviceKey represents one device instance
            relationships.get(key).deviceCount += 1;
        });
    });
    
    // Draw lines
    relationships.forEach(({kunde, techId, deviceCount}) => {
        // Filter if technician is selected
        if (selectedTechnicianForAssignment && techId !== selectedTechnicianForAssignment) {
            return;
        }
        
        const tech = techniker.find(t => t.id === techId);
        if (!tech || tech.visible === false) return;
        
        const isSelected = selectedTechnicianForAssignment === techId;
        
        const line = L.polyline(
            [[tech.lat, tech.lng], [kunde.lat, kunde.lng]],
            {
                color: isSelected ? '#3498db' : '#95a5a6',
                weight: isSelected ? 3 : 2,
                opacity: isSelected ? 0.8 : 0.4,
                dashArray: '5, 5'
            }
        ).addTo(map);
        
        // Add tooltip showing device count
        line.bindTooltip(`${tech.name} → ${kunde.name}<br>${deviceCount} ${deviceCount === 1 ? 'Gerät' : 'Geräte'}`, {
            permanent: false,
            direction: 'center'
        });
        
        assignmentLines.push(line);
    });
}

// Clear assignment lines from map
function clearAssignmentLines() {
    assignmentLines.forEach(line => {
        map.removeLayer(line);
    });
    assignmentLines = [];
}

// Export assignments to Excel
function exportAssignmentsExcel() {
    console.log('📊 Exportiere Zuweisungen...');
    
    // Calculate total weight for each technician
    const technicianWeights = {};
    
    kunden.forEach(kunde => {
        if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) return;
        
        const deviceIndices = {};
        kunde.instrumentLines.forEach((device) => {
            const trimmedDevice = device.trim();
            if (!trimmedDevice) return;
            
            if (!deviceIndices[trimmedDevice]) {
                deviceIndices[trimmedDevice] = 0;
            }
            const deviceIndex = deviceIndices[trimmedDevice];
            deviceIndices[trimmedDevice]++;
            
            const deviceKey = `${trimmedDevice}_${deviceIndex}`;
            const assignedTechId = kunde.deviceAssignments ? kunde.deviceAssignments[deviceKey] : null;
            
            if (assignedTechId) {
                const weight = deviceWeights[trimmedDevice] || 1.0;
                if (!technicianWeights[assignedTechId]) {
                    technicianWeights[assignedTechId] = 0;
                }
                technicianWeights[assignedTechId] += weight;
            }
        });
    });
    
    // Prepare data
    const data = [];
    
    // Header row
    data.push(['Kunde', 'PLZ', 'Ort', 'Gerät', 'Geräte-Nr', 'Gerätegewichtung', 'Zugewiesener Techniker', 'Techniker Gesamtgewichtung']);
    
    // Sort customers alphabetically
    const sortedCustomers = [...kunden].sort((a, b) => a.name.localeCompare(b.name));
    
    sortedCustomers.forEach(kunde => {
        if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) {
            // Customer with no devices
            data.push([
                kunde.name,
                kunde.plz || '',
                kunde.ort || '',
                'Keine Geräte',
                '-',
                '-',
                '-',
                '-'
            ]);
            return;
        }
        
        // Export each individual device instance
        const deviceIndices = {}; // Track indices for each device type
        
        kunde.instrumentLines.forEach((device, arrayIndex) => {
            const trimmedDevice = device.trim();
            if (!trimmedDevice) return;
            
            // Track index for this device type
            if (!deviceIndices[trimmedDevice]) {
                deviceIndices[trimmedDevice] = 0;
            }
            const deviceIndex = deviceIndices[trimmedDevice];
            deviceIndices[trimmedDevice]++;
            
            // Create device key
            const deviceKey = `${trimmedDevice}_${deviceIndex}`;
            
            // Get assignment
            const assignedTechId = kunde.deviceAssignments ? kunde.deviceAssignments[deviceKey] : null;
            const assignedTech = assignedTechId ? techniker.find(t => t.id === assignedTechId) : null;
            
            // Get device weight
            const deviceWeight = deviceWeights[trimmedDevice] || 1.0;
            
            // Get total weight for this technician
            const techTotalWeight = assignedTechId ? (technicianWeights[assignedTechId] || 0).toFixed(1) : '-';
            
            // Count total devices of this type for display
            const totalOfType = kunde.instrumentLines.filter(d => d.trim() === trimmedDevice).length;
            const deviceNumber = totalOfType > 1 ? `#${deviceIndex + 1}` : '-';
            
            data.push([
                kunde.name,
                kunde.plz || '',
                kunde.ort || '',
                trimmedDevice,
                deviceNumber,
                deviceWeight.toFixed(1),
                assignedTech ? assignedTech.name : 'Nicht zugewiesen',
                techTotalWeight
            ]);
        });
    });
    
    // Create workbook
    const ws = XLSX.utils.aoa_to_sheet(data);
    
    // Set column widths
    ws['!cols'] = [
        { wch: 30 },  // Kunde
        { wch: 8 },   // PLZ
        { wch: 20 },  // Ort
        { wch: 25 },  // Gerät
        { wch: 10 },  // Nr
        { wch: 18 },  // Gerätegewichtung
        { wch: 30 },  // Techniker
        { wch: 25 }   // Techniker Gesamtgewichtung
    ];
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Gerätezuweisungen');
    
    // Download
    const filename = `Gerätezuweisungen_${formatDate(new Date()).replace(/-/g, '')}.xlsx`;
    XLSX.writeFile(wb, filename);
    
    console.log(`✅ Export erfolgreich: ${filename}`);
    alert(`✅ Gerätezuweisungen exportiert!\n\nDatei: ${filename}`);
}

// Import assignments from Excel
async function importAssignmentsExcel(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    console.log('📥 Importiere Zuweisungen aus Excel...');
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);
            
            console.log(`📊 Gefundene Zeilen: ${jsonData.length}`);
            
            let successCount = 0;
            let errorCount = 0;
            
            jsonData.forEach((row, index) => {
                // Find customer by name
                const customerName = row['Kunde'] || row['Name'] || row['Kundenname'];
                if (!customerName) {
                    console.warn(`⚠️ Zeile ${index + 2}: Kein Kundenname gefunden`);
                    errorCount++;
                    return;
                }
                
                const kunde = kunden.find(k => k.name.toLowerCase() === customerName.toLowerCase());
                if (!kunde) {
                    console.warn(`⚠️ Zeile ${index + 2}: Kunde "${customerName}" nicht gefunden`);
                    errorCount++;
                    return;
                }
                
                // Get assigned technicians
                const techNames = row['Zugewiesene Techniker'] || row['Techniker'] || '';
                if (!techNames || techNames === 'Nicht zugewiesen') {
                    // Clear assignments
                    kunde.assignedTechnicianIds = [];
                    successCount++;
                    return;
                }
                
                // Split by comma and find technicians
                const techNameList = techNames.split(',').map(name => name.trim());
                const techIds = [];
                
                techNameList.forEach(techName => {
                    const tech = techniker.find(t => t.name.toLowerCase() === techName.toLowerCase());
                    if (tech) {
                        techIds.push(tech.id);
                    } else {
                        console.warn(`⚠️ Zeile ${index + 2}: Techniker "${techName}" nicht gefunden`);
                    }
                });
                
                kunde.assignedTechnicianIds = techIds;
                successCount++;
            });
            
            // Save and refresh
            saveToLocalStorage();
            refreshAssignmentPanel();
            updateAssignmentLines();
            
            alert(`✅ Import abgeschlossen!\n\n✓ ${successCount} Kunden aktualisiert\n${errorCount > 0 ? `⚠️ ${errorCount} Fehler` : ''}`);
            console.log(`✅ Import erfolgreich: ${successCount} Kunden, ${errorCount} Fehler`);
            
        } catch (error) {
            console.error('❌ Import-Fehler:', error);
            alert('❌ Fehler beim Importieren der Datei:\n' + error.message);
        }
    };
    
    reader.readAsArrayBuffer(file);
    
    // Reset file input
    event.target.value = '';
}

// Clear all assignments
function clearAllAssignments() {
    if (!confirm('⚠️ Alle Gerätezuweisungen wirklich löschen?')) {
        return;
    }
    
    kunden.forEach(kunde => {
        kunde.deviceAssignments = {};
    });
    
    saveToLocalStorage();
    refreshAssignmentPanel();
    updateAssignmentLines();
    
    alert('✅ Alle Zuweisungen wurden gelöscht');
    console.log('🗑️ Alle Zuweisungen gelöscht');
}

// ===== DEVICE WEIGHTS MANAGEMENT =====

// Get weight for a device (default 1.0 if not set)
function getDeviceWeight(deviceType) {
    if (!deviceType) return 1.0;
    const trimmed = deviceType.trim();
    return deviceWeights[trimmed] !== undefined ? deviceWeights[trimmed] : 1.0;
}

// Update device weights UI in settings
function updateDeviceWeightsUI() {
    const container = document.getElementById('deviceWeightsList');
    if (!container) return;
    
    // Extract all unique device types from customers
    const allDevices = new Set();
    kunden.forEach(kunde => {
        if (kunde.instrumentLines && Array.isArray(kunde.instrumentLines)) {
            kunde.instrumentLines.forEach(device => {
                if (device && device.trim()) {
                    allDevices.add(device.trim());
                }
            });
        }
    });
    
    if (allDevices.size === 0) {
        container.innerHTML = '<small style="color: #95a5a6;">Keine Geräte vorhanden. Importieren Sie erst Kunden.</small>';
        return;
    }
    
    // Sort devices alphabetically
    const sortedDevices = Array.from(allDevices).sort();
    
    // Build UI
    let html = '<div style="display: grid; gap: 12px;">';
    
    sortedDevices.forEach(device => {
        const currentWeight = getDeviceWeight(device);
        html += `
            <div style="display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 10px; background: #f8f9fa; border-radius: 6px;">
                <label style="font-weight: 600; color: #2c3e50; font-size: 13px;">
                    🏭 ${device}
                </label>
                <input 
                    type="number" 
                    id="weight_${device.replace(/[^a-zA-Z0-9]/g, '_')}" 
                    value="${currentWeight}" 
                    step="0.1" 
                    min="0.1" 
                    max="10"
                    data-device="${device}"
                    style="width: 80px; padding: 6px; border: 1px solid #ddd; border-radius: 4px; text-align: center; font-weight: 600;"
                />
            </div>
        `;
    });
    
    html += '</div>';
    container.innerHTML = html;
}

// Save device weights from UI
function saveDeviceWeights() {
    const inputs = document.querySelectorAll('#deviceWeightsList input[data-device]');
    let changeCount = 0;
    
    inputs.forEach(input => {
        const device = input.dataset.device;
        const value = parseFloat(input.value);
        
        if (!isNaN(value) && value > 0) {
            const oldValue = deviceWeights[device];
            deviceWeights[device] = value;
            
            if (oldValue !== value) {
                changeCount++;
            }
        }
    });
    
    saveToLocalStorage();
    
    console.log('⚖️ Gerätegewichtungen gespeichert:', deviceWeights);
    alert(`✅ ${changeCount} Gewichtung(en) aktualisiert und gespeichert!`);
    
    // Refresh UI to show updated weights in customer lists
    if (assignmentMode) {
        refreshAssignmentPanel();
    }
}

// Calculate total weight for a customer's devices
function calculateCustomerDeviceWeight(kunde) {
    if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) {
        return 0;
    }
    
    let totalWeight = 0;
    kunde.instrumentLines.forEach(device => {
        if (device && device.trim()) {
            totalWeight += getDeviceWeight(device.trim());
        }
    });
    
    return totalWeight;
}

// ===== AUTOMATIC DEVICE ASSIGNMENT =====

function autoAssignDevices() {
    console.log('🤖 Starte automatische Gerätezuweisung...');
    
    // Check if isochrones are loaded
    if (isochroneGeoJSON.length === 0) {
        alert('⚠️ Keine Isochronen geladen!\n\nBitte zuerst "Isochronen laden" klicken, damit die Reichweite der Techniker berechnet werden kann.');
        return;
    }
    
    // Confirm action
    const keepExisting = confirm(
        '🤖 Automatische Gerätezuweisung\n\n' +
        'Der Algorithmus verteilt Geräte automatisch nach folgenden Regeln:\n\n' +
        '1. ✅ Skill muss passen\n' +
        '2. ✅ Kunde in Reichweite (Isochrone)\n' +
        '3. 🎯 Ein Techniker pro Kunde bevorzugt\n' +
        '4. ⚖️ Faire Verteilung (ähnliche Geräteanzahl)\n\n' +
        'Bestehende Zuweisungen behalten?\n\n' +
        '✅ OK = Behalten und ergänzen\n' +
        '❌ Abbrechen = Alles neu zuweisen'
    );
    
    const startTime = performance.now();
    
    // Track statistics
    const stats = {
        totalDevices: 0,
        assignedDevices: 0,
        customersFullyAssigned: 0,
        customersPartiallyAssigned: 0,
        customersUnassigned: 0,
        customersOutOfReach: 0,
        technicianWorkload: {} // { techId: deviceCount }
    };
    
    // Initialize technician workload
    techniker.forEach(tech => {
        stats.technicianWorkload[tech.id] = 0;
    });
    
    // If not keeping existing, clear all assignments
    if (!keepExisting) {
        kunden.forEach(kunde => {
            kunde.deviceAssignments = {};
        });
    } else {
        // Count existing assignments
        kunden.forEach(kunde => {
            if (kunde.deviceAssignments) {
                Object.entries(kunde.deviceAssignments).forEach(([device, techId]) => {
                    const deviceCount = kunde.instrumentLines.filter(d => d === device).length;
                    if (stats.technicianWorkload[techId] !== undefined) {
                        stats.technicianWorkload[techId] += deviceCount;
                    }
                });
            }
        });
    }
    
    console.log('📊 Initiale Techniker-Auslastung:', stats.technicianWorkload);
    
    // Process each customer
    kunden.forEach((kunde, index) => {
        if (!kunde.instrumentLines || kunde.instrumentLines.length === 0) {
            stats.customersUnassigned++;
            return;
        }
        
        stats.totalDevices += kunde.instrumentLines.length;
        
        // Check if customer is reachable by any technician
        const reachableTechnicians = techniker.filter(tech => 
            isCustomerInTechnicianReach(kunde, tech)
        );
        
        if (reachableTechnicians.length === 0) {
            console.log(`⚠️ Kunde "${kunde.name}" außerhalb aller Isochronen - übersprungen`);
            stats.customersOutOfReach++;
            return;
        }
        
        // Initialize if not present
        if (!kunde.deviceAssignments) {
            kunde.deviceAssignments = {};
        }
        
        // Get unique device types
        const uniqueDevices = [...new Set(kunde.instrumentLines)];
        
        // Try to find ONE technician who can handle ALL device types (preferred)
        let bestTechForAll = null;
        let bestTechCoverage = 0;
        
        reachableTechnicians.forEach(tech => {
            const techSkills = tech.skills || [];
            
            // Count how many unique device types this tech can handle
            let canHandle = uniqueDevices.filter(device => {
                return techSkills.length === 0 || 
                       techSkills.some(skill => 
                           device.toLowerCase().includes(skill.toLowerCase()) ||
                           skill.toLowerCase().includes(device.toLowerCase())
                       );
            }).length;
            
            if (canHandle > bestTechCoverage) {
                bestTechCoverage = canHandle;
                bestTechForAll = tech;
            } else if (canHandle === bestTechCoverage && bestTechForAll) {
                // Tie-breaker: choose technician with less workload
                if (stats.technicianWorkload[tech.id] < stats.technicianWorkload[bestTechForAll.id]) {
                    bestTechForAll = tech;
                }
            }
        });
        
        // Assign each individual device instance
        let assignedCount = 0;
        const deviceIndices = {}; // Track indices for each device type
        
        kunde.instrumentLines.forEach((device, arrayIndex) => {
            const trimmedDevice = device.trim();
            if (!trimmedDevice) return;
            
            // Track index for this device type
            if (!deviceIndices[trimmedDevice]) {
                deviceIndices[trimmedDevice] = 0;
            }
            const deviceIndex = deviceIndices[trimmedDevice];
            deviceIndices[trimmedDevice]++;
            
            // Create device key
            const deviceKey = `${trimmedDevice}_${deviceIndex}`;
            
            // Skip if already assigned and keeping existing
            if (keepExisting && kunde.deviceAssignments[deviceKey]) {
                assignedCount++;
                stats.assignedDevices++;
                return;
            }
            
            // Try to assign to best overall technician first
            if (bestTechForAll) {
                const techSkills = bestTechForAll.skills || [];
                const canHandle = techSkills.length === 0 || 
                                techSkills.some(skill => 
                                    trimmedDevice.toLowerCase().includes(skill.toLowerCase()) ||
                                    skill.toLowerCase().includes(trimmedDevice.toLowerCase())
                                );
                
                if (canHandle) {
                    kunde.deviceAssignments[deviceKey] = bestTechForAll.id;
                    stats.technicianWorkload[bestTechForAll.id]++;
                    assignedCount++;
                    stats.assignedDevices++;
                    return;
                }
            }
            
            // If best tech can't handle this device, find alternative
            const candidateTechs = reachableTechnicians.filter(tech => {
                const techSkills = tech.skills || [];
                return techSkills.length === 0 || 
                       techSkills.some(skill => 
                           trimmedDevice.toLowerCase().includes(skill.toLowerCase()) ||
                           skill.toLowerCase().includes(trimmedDevice.toLowerCase())
                       );
            });
            
            if (candidateTechs.length > 0) {
                // Choose technician with least workload (fairness)
                candidateTechs.sort((a, b) => 
                    stats.technicianWorkload[a.id] - stats.technicianWorkload[b.id]
                );
                
                const assignedTech = candidateTechs[0];
                kunde.deviceAssignments[deviceKey] = assignedTech.id;
                stats.technicianWorkload[assignedTech.id]++;
                assignedCount++;
                stats.assignedDevices++;
            }
        });
        
        // Update customer statistics
        const totalDevicesForCustomer = kunde.instrumentLines.length;
        if (assignedCount === 0) {
            stats.customersUnassigned++;
        } else if (assignedCount === totalDevicesForCustomer) {
            stats.customersFullyAssigned++;
        } else {
            stats.customersPartiallyAssigned++;
        }
    });
    
    const duration = performance.now() - startTime;
    console.log(`✅ Auto-Zuweisung abgeschlossen in ${(duration / 1000).toFixed(2)}s`);
    console.log('📊 Finale Techniker-Auslastung:', stats.technicianWorkload);
    
    // Save and refresh
    saveToLocalStorage();
    refreshAssignmentPanel();
    updateAssignmentLines();
    
    // Show results
    const workloadList = Object.entries(stats.technicianWorkload)
        .map(([techId, count]) => {
            const tech = techniker.find(t => t.id === parseInt(techId));
            return { name: tech ? tech.name : 'Unbekannt', count: count };
        })
        .filter(item => item.count > 0)
        .sort((a, b) => b.count - a.count)
        .map(item => `  • ${item.name}: ${item.count} Geräte`)
        .join('\n');
    
    const avgWorkload = stats.assignedDevices / Object.values(stats.technicianWorkload).filter(w => w > 0).length;
    
    alert(
        `✅ Automatische Zuweisung abgeschlossen!\n\n` +
        `📊 Statistik:\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Geräte gesamt: ${stats.totalDevices}\n` +
        `Geräte zugewiesen: ${stats.assignedDevices} (${Math.round(stats.assignedDevices / stats.totalDevices * 100)}%)\n\n` +
        `👥 Kunden:\n` +
        `  ✅ Vollständig zugewiesen: ${stats.customersFullyAssigned}\n` +
        `  🟡 Teilweise zugewiesen: ${stats.customersPartiallyAssigned}\n` +
        `  ⚠️ Nicht zugewiesen: ${stats.customersUnassigned}\n` +
        `  🔴 Außerhalb Reichweite: ${stats.customersOutOfReach}\n\n` +
        `⚖️ Durchschnittliche Auslastung: ${avgWorkload.toFixed(1)} Geräte/Techniker\n\n` +
        `🔧 Techniker-Auslastung:\n` +
        `${workloadList}\n\n` +
        `⏱️ Dauer: ${(duration / 1000).toFixed(2)}s`
    );
}

// ===== END AUTOMATIC DEVICE ASSIGNMENT =====

// ===== END CUSTOMER ASSIGNMENT SYSTEM =====
