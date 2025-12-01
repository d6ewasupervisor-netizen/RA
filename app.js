// === PEGASUS - Planogram Execution Guide And Store User Support ===
// === CONFIGURATION ===
const REPO_BASE = window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1);

// Board Physics (1 unit = 1 inch)
const BOARD_WIDTH_INCHES = 48;  // Col 1 to 46 + extra space for products
const BOARD_HEIGHT_INCHES = 64; // Row 1 to 64

// === GLOBAL VARIABLES ===
let PPI = 0; // Pixels Per Inch (Calculated dynamically)
let fileIndex = [];  // Array of filename STRINGS
let pogData = [];
let storeMap = [];
let deleteData = []; // Items to be deleted
let currentStore = null;
let currentPOG = null;
let currentBay = 1;
let allBays = [];
let html5QrCode = null;
let completedItems = new Set(JSON.parse(localStorage.getItem('harpa_complete') || "[]"));
let headerCollapsed = true; // START COLLAPSED (new feature)
let currentItemBox = null; // Currently selected item for the modal
let largeFontMode = localStorage.getItem('pegasus_largefont') === 'true';

// Multi-match navigation state
let currentMatches = [];
let currentMatchIndex = 0;

// Audio context for feedback sounds
let audioContext = null;

// Track bay completion for celebrations
let bayCompletionShown = new Set();
let pogCompleteShown = false;

// === AUDIO FEEDBACK SYSTEM ===
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.log("Audio not supported");
    }
}

function playTone(frequency, duration, type = 'sine', volume = 0.3) {
    if (!audioContext) return;
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.frequency.value = frequency;
        oscillator.type = type;
        gainNode.gain.value = volume;
        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
        oscillator.stop(audioContext.currentTime + duration);
    } catch (e) { }
}

function playFoundSound() {
    playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 100); setTimeout(() => playTone(784, 0.2), 200);
}
function playNotFoundSound() { playTone(300, 0.3, 'square', 0.2); }
function playDeleteSound() {
    playTone(600, 0.15); setTimeout(() => playTone(400, 0.15), 100); setTimeout(() => playTone(250, 0.25), 200);
}
function playCompleteSound() { playTone(800, 0.08); setTimeout(() => playTone(1200, 0.1), 50); }
function playRowChangeSound() { playTone(600, 0.1, 'sine', 0.15); }
function playCelebrationSound() {
    playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 100);
    setTimeout(() => playTone(784, 0.15), 200); setTimeout(() => playTone(1047, 0.3), 300);
}
function playPogCompleteSound() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((freq, i) => setTimeout(() => playTone(freq, 0.2), i * 120));
}

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
    init();
    setupSwipe();
    document.addEventListener('click', () => { if (!audioContext) initAudio(); }, { once: true });
    window.addEventListener('resize', () => { if (currentPOG && currentBay) renderGrid(currentBay); });
    if (largeFontMode) document.body.classList.add('large-font-mode');
});

async function init() {
    try {
        await loadCSVData();
        document.getElementById('loading-overlay').classList.add('hidden');
        
        const savedStore = localStorage.getItem('harpa_store');
        if (savedStore) {
            loadStoreLogic(savedStore);
        } else {
            document.getElementById('store-modal').classList.remove('hidden');
        }
    } catch (e) {
        console.error("Data Load Error:", e);
        document.getElementById('loading-overlay').innerHTML = `
            <div class="modal-card">
                <h3>⚠️ Data Load Error</h3>
                <p style="color:#666; margin:10px 0;">${e.message}</p>
            </div>
        `;
    }

    // Event Bindings
    document.getElementById('btn-load-store').onclick = () => 
        loadStoreLogic(document.getElementById('store-input').value.trim());
    
    document.getElementById('store-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loadStoreLogic(document.getElementById('store-input').value.trim());
    });
    
    document.getElementById('btn-scan-toggle').onclick = startScanner;
    
    document.getElementById('btn-manual-search').onclick = () => {
        const input = document.getElementById('search-input');
        handleSearchOrScan(input.value.trim(), false);
        input.value = '';
    };
    
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const input = document.getElementById('search-input');
            handleSearchOrScan(input.value.trim(), false);
            input.value = '';
        }
    });
}

// === HEADER COLLAPSE/EXPAND ===
function toggleHeader() {
    const header = document.getElementById('main-header');
    const floatingBtns = document.getElementById('floating-btns');
    headerCollapsed = !headerCollapsed;
    
    if (headerCollapsed) {
        header.classList.add('collapsed');
        floatingBtns.classList.remove('hidden');
    } else {
        header.classList.remove('collapsed');
        floatingBtns.classList.add('hidden');
    }
    setTimeout(() => { if (currentPOG && currentBay) renderGrid(currentBay); }, 350);
}

// === FONT SIZE TOGGLE ===
function toggleFontSize() {
    largeFontMode = !largeFontMode;
    localStorage.setItem('pegasus_largefont', largeFontMode);
    if (largeFontMode) {
        document.body.classList.add('large-font-mode');
        showToast('Large text mode ON - some labels may overlap', 2000);
    } else {
        document.body.classList.remove('large-font-mode');
        showToast('Large text mode OFF', 1500);
    }
    if (currentPOG && currentBay) setTimeout(() => renderGrid(currentBay), 100);
}

function showToast(message, duration = 2000) {
    const toast = document.getElementById('row-toast');
    document.getElementById('row-toast-text').innerText = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
}

// === DATA LOADING ===
async function loadCSVData() {
    const ts = Date.now();
    
    const [filesResp, pogsResp, mapsResp, deletesResp] = await Promise.all([
        fetch(`githubfiles.csv?t=${ts}`),
        fetch(`allplanogramdata.csv?t=${ts}`),
        fetch(`Store_POG_Mapping.csv?t=${ts}`),
        fetch(`Deletes.csv?t=${ts}`).catch(() => null)
    ]);
    
    if (!filesResp.ok) throw new Error("githubfiles.csv not found");
    if (!pogsResp.ok) throw new Error("allplanogramdata.csv not found");
    if (!mapsResp.ok) throw new Error("Store_POG_Mapping.csv not found");

    const [files, pogs, maps] = await Promise.all([
        filesResp.text(),
        pogsResp.text(),
        mapsResp.text()
    ]);

    // fileIndex is an array of filename STRINGS
    fileIndex = files.split('\n').map(l => l.trim()).filter(l => l);
    pogData = parseCSV(pogs).map(i => ({...i, CleanUPC: normalizeUPC(i.UPC)}));
    storeMap = parseCSV(maps);
    
    // Load deletes data if file exists
    if (deletesResp && deletesResp.ok) {
        const deletesText = await deletesResp.text();
        deleteData = parseCSV(deletesText).map(i => ({...i, CleanUPC: normalizeUPC(i.UPC)}));
        console.log(`Loaded: ${deleteData.length} delete items`);
    }
    
    console.log(`Loaded: ${fileIndex.length} files, ${pogData.length} products, ${storeMap.length} store mappings`);
}

function parseCSV(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    const res = [];
    
    for (let i = 1; i < lines.length; i++) {
        const row = parseCSVLine(lines[i]);
        if (row.length < headers.length) continue;
        let obj = {};
        headers.forEach((h, j) => obj[h] = row[j] || "");
        res.push(obj);
    }
    return res;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/\r/g, ''));
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim().replace(/\r/g, ''));
    return result;
}

function normalizeUPC(upc) {
    if (!upc) return "";
    let cleaned = upc.toString().trim().replace(/\r/g, '');
    cleaned = cleaned
        .replace(/[OoQq]/g, '0')
        .replace(/[IilL|]/g, '1')
        .replace(/[Ss\$]/g, '5')
        .replace(/[Bb]/g, '8')
        .replace(/[Zz]/g, '2')
        .replace(/[Gg]/g, '6')
        .replace(/[Tt]/g, '7');
    cleaned = cleaned.replace(/[^0-9]/g, '');
    cleaned = cleaned.replace(/^0+/, '');
    if (cleaned === '') cleaned = '0';
    return cleaned;
}

// === STORE LOGIC ===
function loadStoreLogic(storeNum) {
    if (!storeNum) return;
    
    const map = storeMap.find(s => s.Store === storeNum);
    if (!map) {
        document.getElementById('error-msg').classList.remove('hidden');
        setTimeout(() => document.getElementById('error-msg').classList.add('hidden'), 3000);
        return;
    }
    
    currentStore = storeNum;
    currentPOG = map.POG;
    localStorage.setItem('harpa_store', storeNum);

    document.getElementById('store-modal').classList.add('hidden');
    document.getElementById('store-display').innerText = `Store: ${storeNum}`;
    document.getElementById('pog-display').innerText = `POG: ${currentPOG}`;

    const items = pogData.filter(i => i.POG === currentPOG);
    const baySet = new Set(items.map(i => parseInt(i.Bay)).filter(b => !isNaN(b)));
    allBays = [...baySet].sort((a, b) => a - b);
    
    if (allBays.length > 0) {
        currentBay = allBays[0];
        renderGrid(currentBay);
        
        // Start with header collapsed
        const header = document.getElementById('main-header');
        const floatingBtns = document.getElementById('floating-btns');
        headerCollapsed = true;
        header.classList.add('collapsed');
        floatingBtns.classList.remove('hidden');
    }
}

function resetStore() {
    localStorage.removeItem('harpa_store');
    localStorage.removeItem('harpa_complete');
    completedItems.clear();
    location.reload();
}

function startOver() {
    if (!confirm('Reset all items to unset?')) return;
    completedItems.clear();
    localStorage.removeItem('harpa_complete');
    bayCompletionShown.clear();
    pogCompleteShown = false;
    if (currentPOG && currentBay) renderGrid(currentBay);
    showToast('Progress reset!', 1500);
}

// === GRID RENDERING ===
function getCoords(peg) {
    if (!peg) return { r: 1, c: 1 };
    const match = peg.match(/R(\d+)\s*C(\d+)/i);
    return match ? { r: parseInt(match[1]), c: parseInt(match[2]) } : { r: 1, c: 1 };
}

function renderGrid(bayNum) {
    currentBay = bayNum;
    const container = document.getElementById('grid-container');
    const canvas = document.getElementById('main-canvas');
    container.innerHTML = '';

    const availableWidth = canvas.clientWidth - 10;
    const availableHeight = canvas.clientHeight - 10;

    const ppiW = availableWidth / BOARD_WIDTH_INCHES;
    const ppiH = availableHeight / BOARD_HEIGHT_INCHES;
    PPI = Math.min(ppiW, ppiH);

    const pxWidth = BOARD_WIDTH_INCHES * PPI;
    const pxHeight = BOARD_HEIGHT_INCHES * PPI;

    container.style.width = `${pxWidth}px`;
    container.style.height = `${pxHeight}px`;
    container.style.backgroundSize = `${PPI}px ${PPI}px`;
    container.style.backgroundImage = `radial-gradient(#333 15%, transparent 16%)`;

    document.getElementById('bay-indicator').innerText = `Bay ${bayNum}`;

    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
    let doneCount = 0;

    // Build UPC count for repeated UPC detection
    const upcCounts = {};
    const upcPositions = {};
    items.forEach(item => {
        const upc = item.CleanUPC;
        if (!upcCounts[upc]) { upcCounts[upc] = 0; upcPositions[upc] = []; }
        upcCounts[upc]++;
        upcPositions[upc].push(parseInt(item.Position) || 0);
    });

    items.forEach(item => {
        const { r, c } = getCoords(item.Peg);
        const h = parseFloat((item.Height || "6").replace(/\s*in/i, '')) || 6;
        const w = parseFloat((item.Width || "3").replace(/\s*in/i, '')) || 3;

        // --- FROG LOGIC ---
        const holeLeftX = ((c - 1) * PPI) + (PPI / 2);
        const holeY = ((r - 1) * PPI) + (PPI / 2);

        // Frog Red Dot
        const dot = document.createElement('div');
        dot.className = 'frog-dot';
        dot.style.left = `${holeLeftX}px`;
        dot.style.top = `${holeY}px`;
        container.appendChild(dot);

        // Peg Coordinate Label
        const pegLabel = document.createElement('div');
        pegLabel.className = 'peg-label';
        pegLabel.innerText = item.Peg || `R${r} C${c}`;
        pegLabel.style.left = `${holeLeftX}px`;
        pegLabel.style.top = `${holeY - 10}px`;
        pegLabel.style.transform = 'translateX(-50%)';
        container.appendChild(pegLabel);

        const frogCenterX = holeLeftX + (PPI / 2);
        const boxLeft = frogCenterX - ((w * PPI) / 2);
        const boxTop = holeY + (PPI * 0.5);

        // Render Box
        const box = document.createElement('div');
        box.className = 'product-box';
        box.style.width = `${w * PPI}px`;
        box.style.height = `${h * PPI}px`;
        box.style.left = `${boxLeft}px`;
        box.style.top = `${boxTop}px`;
        box.dataset.upc = item.CleanUPC;
        box.dataset.itemData = JSON.stringify(item);

        if (completedItems.has(item.CleanUPC)) {
            box.classList.add('completed');
            doneCount++;
        }

        // Check for repeated UPC
        const upcCount = upcCounts[item.CleanUPC] || 1;
        if (upcCount > 1) {
            box.classList.add('repeated-upc');
            const positions = upcPositions[item.CleanUPC].sort((a, b) => a - b);
            const facingIndex = positions.indexOf(parseInt(item.Position) || 0) + 1;
            const facingBadge = document.createElement('div');
            facingBadge.className = 'facing-badge';
            facingBadge.innerText = `${facingIndex}/${upcCount}`;
            box.appendChild(facingBadge);
            box.dataset.facingInfo = `${facingIndex} of ${upcCount}`;
        }

        // Find image - fileIndex is array of filename STRINGS
        let imgFile = fileIndex.find(f => f.startsWith(item.UPC) && /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        if (!imgFile && item.CleanUPC !== item.UPC) {
            imgFile = fileIndex.find(f => f.startsWith(item.CleanUPC) && /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
        }
        
        box.dataset.imgSrc = imgFile || '';
        const filenameDesc = extractDescriptionFromFilename(imgFile);
        box.dataset.filenameDesc = filenameDesc || '';
        
        if (imgFile) {
            const img = document.createElement('img');
            img.src = imgFile;
            img.alt = item.UPC;
            img.onerror = () => {
                box.innerHTML = `<span style="font-size:${Math.max(6, PPI * 0.8)}px; text-align:center; padding:2px; word-break:break-all;">${item.UPC}</span>`;
                addPositionLabel(box, item.Position);
            };
            box.appendChild(img);
        } else {
            box.innerHTML = `<span style="font-size:${Math.max(6, PPI * 0.8)}px; text-align:center; padding:2px; word-break:break-all;">${item.UPC}</span>`;
        }

        addPositionLabel(box, item.Position);
        box.onclick = () => openProductModal(box);
        container.appendChild(box);
    });

    updateProgress(items, doneCount);
    checkBayCompletion(items, doneCount);
}

function extractDescriptionFromFilename(filename) {
    if (!filename) return null;
    const noExt = filename.replace(/\.(jpg|jpeg|png|gif|webp)$/i, '');
    const desc = noExt.replace(/^\d+[\s_]?/, '');
    return desc.replace(/_/g, ' ').trim() || null;
}

function addPositionLabel(box, position) {
    if (!position) return;
    const posLabel = document.createElement('div');
    posLabel.className = 'position-label';
    posLabel.innerText = position;
    box.appendChild(posLabel);
}

function updateProgress(items, doneCount) {
    const total = items.length;
    const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').innerText = `${doneCount}/${total}`;
}

// === BAY NAVIGATION ===
function changeBay(dir) {
    const idx = allBays.indexOf(currentBay);
    if (idx === -1) return;
    let newIdx = idx + dir;
    newIdx = Math.max(0, Math.min(newIdx, allBays.length - 1));
    if (allBays[newIdx] !== currentBay) {
        currentBay = allBays[newIdx];
        showBayOverlay(currentBay);
        renderGrid(currentBay);
    }
}

function loadBay(bayNum, showOverlay = false) {
    if (!allBays.includes(bayNum)) return;
    currentBay = bayNum;
    if (showOverlay) showBayOverlay(currentBay);
    renderGrid(currentBay);
}

function showBayOverlay(bayNum) {
    const overlay = document.getElementById('bay-overlay');
    document.getElementById('bay-overlay-number').innerText = bayNum;
    overlay.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(50);
    setTimeout(() => overlay.classList.add('hidden'), 1200);
}

// === SWIPE NAVIGATION ===
function setupSwipe() {
    const main = document.getElementById('main-canvas');
    let touchStartX = 0;
    let swipeDirection = null;
    let holdTimer = null;
    
    main.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        swipeDirection = null;
        if (holdTimer) clearTimeout(holdTimer);
    }, { passive: true });
    
    main.addEventListener('touchmove', (e) => {
        const deltaX = e.touches[0].clientX - touchStartX;
        if (Math.abs(deltaX) > 60) {
            const newDirection = deltaX > 0 ? 'right' : 'left';
            if (newDirection !== swipeDirection) {
                swipeDirection = newDirection;
                if (holdTimer) clearTimeout(holdTimer);
                holdTimer = setTimeout(() => {
                    if (swipeDirection === 'left') changeBay(1);
                    else if (swipeDirection === 'right') changeBay(-1);
                    swipeDirection = null;
                }, 400);
            }
        }
    }, { passive: true });
    
    main.addEventListener('touchend', () => { if (holdTimer) clearTimeout(holdTimer); swipeDirection = null; });
    main.addEventListener('touchcancel', () => { if (holdTimer) clearTimeout(holdTimer); swipeDirection = null; });
}

// === BARCODE SCANNER ===
let isProcessingScan = false;

function startScanner() {
    // Prevent multiple instances
    if (html5QrCode) {
        console.log("Scanner already running");
        return;
    }
    
    const modal = document.getElementById('scanner-modal');
    const readerDiv = document.getElementById('reader');
    
    // Clear any previous content
    readerDiv.innerHTML = '';
    
    modal.classList.remove('hidden');
    isProcessingScan = false;
    if (!audioContext) initAudio();
    
    try {
        html5QrCode = new Html5Qrcode("reader");
        
        const scanConfig = { 
            fps: 10, 
            qrbox: { width: 280, height: 150 },
            formatsToSupport: [ 
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.QR_CODE
            ]
        };
        
        html5QrCode.start(
            { facingMode: "environment" }, 
            scanConfig,
            (decodedText) => {
                if (isProcessingScan) return;
                isProcessingScan = true;
                console.log(`📷 RAW SCAN: "${decodedText}"`);
                
                // Vibrate on successful scan
                if (navigator.vibrate) navigator.vibrate(100);
                
                stopScanner();
                setTimeout(() => handleSearchOrScan(decodedText, true), 100);
            },
            (err) => { /* Ignore scan errors */ }
        ).catch(e => {
            console.error("Camera start error:", e);
            alert("Camera Error: " + e.message || e);
            stopScanner();
        });
    } catch (e) {
        console.error("Scanner init error:", e);
        alert("Scanner initialization failed: " + e.message || e);
        modal.classList.add('hidden');
    }
}

function stopScanner() {
    const modal = document.getElementById('scanner-modal');
    modal.classList.add('hidden');
    
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            try {
                html5QrCode.clear();
            } catch (e) {
                console.log("Scanner clear warning:", e);
            }
            html5QrCode = null;
            isProcessingScan = false;
        }).catch((e) => {
            console.log("Scanner stop warning:", e);
            html5QrCode = null;
            isProcessingScan = false;
        });
    } else {
        isProcessingScan = false;
    }
}

// === SEARCH / SCAN HANDLING ===
function handleSearchOrScan(input, fromScanner = false) {
    if (!input) return false;
    hideMultiMatchBar();
    
    const clean = normalizeUPC(input);
    const cleanNoCheckDigit = clean.length > 1 ? clean.slice(0, -1) : clean;
    
    const scanResult = document.getElementById('scan-result');
    scanResult.className = ''; // Reset classes
    scanResult.innerText = `Searching: ${cleanNoCheckDigit}`;

    // Check for DELETE item first
    const deleteMatch = checkForDelete(clean, cleanNoCheckDigit);
    if (deleteMatch) {
        playDeleteSound();
        showDeleteOverlay(deleteMatch.UPC || cleanNoCheckDigit, deleteMatch.Product || 'Unknown Item');
        scanResult.innerText = `🗑️ DELETE: ${deleteMatch.Product || cleanNoCheckDigit}`;
        scanResult.className = 'delete';
        return true;
    }

    const itemsInPOG = pogData.filter(i => i.POG === currentPOG);
    if (itemsInPOG.length === 0) {
        playNotFoundSound();
        showNotFoundOverlay();
        scanResult.innerText = `"${cleanNoCheckDigit}" not found`;
        scanResult.className = 'not-found';
        return false;
    }

    let matches = findAllMatches(itemsInPOG, clean, cleanNoCheckDigit, fromScanner);
    
    if (matches.length === 0) {
        playNotFoundSound();
        showNotFoundOverlay();
        scanResult.innerText = `"${cleanNoCheckDigit}" not found`;
        scanResult.className = 'not-found';
        return false;
    }

    playFoundSound();
    currentMatches = matches;
    currentMatchIndex = 0;
    showMatchAtIndex(0, true);
    return true;
}

function findAllMatches(itemsInPOG, clean, cleanNoCheckDigit, fromScanner) {
    let matches = [];
    
    if (!fromScanner && clean.length <= 4) {
        matches = itemsInPOG.filter(i => i.CleanUPC.endsWith(clean) || i.CleanUPC.endsWith(cleanNoCheckDigit));
    } else {
        matches = itemsInPOG.filter(i => i.CleanUPC === clean);
        if (matches.length === 0) matches = itemsInPOG.filter(i => i.CleanUPC === cleanNoCheckDigit);
        if (matches.length === 0) matches = itemsInPOG.filter(i => i.CleanUPC.slice(0, -1) === clean);
    }
    
    matches.sort((a, b) => {
        const bayDiff = parseInt(a.Bay) - parseInt(b.Bay);
        if (bayDiff !== 0) return bayDiff;
        return (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0);
    });
    
    return matches;
}

function showMatchAtIndex(index, showOverlay = false) {
    if (index < 0 || index >= currentMatches.length) return;
    currentMatchIndex = index;
    const match = currentMatches[index];
    
    let resultText = `✓ Bay ${match.Bay}, Pos ${match.Position}, ${match.Peg}`;
    if (currentMatches.length > 1) resultText += ` (${index + 1} of ${currentMatches.length})`;
    
    const scanResult = document.getElementById('scan-result');
    scanResult.innerText = resultText;
    scanResult.className = 'found';
    
    if (currentMatches.length > 1) showMultiMatchBar();
    else hideMultiMatchBar();
    
    // Collapse header
    if (!headerCollapsed) {
        headerCollapsed = true;
        document.getElementById('main-header').classList.add('collapsed');
        document.getElementById('floating-btns').classList.remove('hidden');
    }
    
    if (showOverlay) {
        showFoundOverlay(match);
        setTimeout(() => navigateToMatch(match), 2500);
    } else {
        navigateToMatch(match);
    }
}

function navigateToMatch(match) {
    const itemBay = parseInt(match.Bay);
    if (itemBay !== currentBay) {
        loadBay(itemBay, false);
        setTimeout(() => highlightItem(match.CleanUPC), 300);
    } else {
        renderGrid(currentBay);
        setTimeout(() => highlightItem(match.CleanUPC), 100);
    }
}

function showNextMatch() {
    if (currentMatches.length === 0) return;
    showMatchAtIndex((currentMatchIndex + 1) % currentMatches.length, false);
}

function showPrevMatch() {
    if (currentMatches.length === 0) return;
    showMatchAtIndex((currentMatchIndex - 1 + currentMatches.length) % currentMatches.length, false);
}

function showMultiMatchBar() {
    document.getElementById('match-indicator').innerText = `${currentMatchIndex + 1} of ${currentMatches.length}`;
    document.getElementById('multi-match-bar').classList.remove('hidden');
}

function hideMultiMatchBar() {
    document.getElementById('multi-match-bar').classList.add('hidden');
    currentMatches = [];
    currentMatchIndex = 0;
}

function showFoundOverlay(match) {
    const overlay = document.getElementById('found-overlay');
    document.getElementById('found-overlay-bay').innerText = `Bay ${match.Bay}`;
    document.getElementById('found-overlay-position').innerText = `Position ${match.Position || '--'}`;
    document.getElementById('found-overlay-peg').innerText = match.Peg || 'R-- C--';
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3000);
}

function showNotFoundOverlay() {
    const overlay = document.getElementById('notfound-overlay');
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 3000);
}

function highlightItem(upc) {
    document.querySelectorAll('.product-box.highlight').forEach(el => el.classList.remove('highlight'));
    const box = document.querySelector(`.product-box[data-upc="${upc}"]`);
    if (box) {
        box.classList.add('highlight');
        setTimeout(() => box.classList.remove('highlight'), 5000);
    }
}

// === DELETE CHECKING ===
function checkForDelete(cleanUPC, cleanNoCheckDigit) {
    if (!deleteData || deleteData.length === 0) return null;
    const deletesInPOG = deleteData.filter(d => d.POG === currentPOG);
    if (deletesInPOG.length === 0) return null;
    
    let match = deletesInPOG.find(d => d.CleanUPC === cleanUPC);
    if (!match) match = deletesInPOG.find(d => d.CleanUPC === cleanNoCheckDigit);
    if (!match) match = deletesInPOG.find(d => d.CleanUPC.slice(0, -1) === cleanUPC);
    return match;
}

function showDeleteOverlay(upc, description) {
    const overlay = document.getElementById('delete-overlay');
    document.getElementById('delete-overlay-upc').innerText = upc;
    document.getElementById('delete-overlay-desc').innerText = description;
    overlay.classList.remove('hidden');
    setTimeout(() => overlay.classList.add('hidden'), 4000);
}

// === PRODUCT DETAIL MODAL ===
function openProductModal(box) {
    currentItemBox = box;
    const item = JSON.parse(box.dataset.itemData);
    const imgSrc = box.dataset.imgSrc;
    const filenameDesc = box.dataset.filenameDesc;
    const facingInfo = box.dataset.facingInfo;
    
    document.getElementById('detail-peg').innerText = item.Peg || `R-- C--`;
    document.getElementById('detail-position').innerText = item.Position || '--';
    document.getElementById('detail-upc').innerText = item.UPC || '--';
    document.getElementById('detail-desc').innerText = filenameDesc || item.ProductDescription || item.Description || '--';
    document.getElementById('detail-size').innerText = `${item.Width} × ${item.Height}`;
    
    const facingRow = document.getElementById('detail-facing-row');
    if (facingInfo) {
        document.getElementById('detail-facing').innerText = facingInfo;
        facingRow.classList.remove('hidden');
    } else {
        facingRow.classList.add('hidden');
    }
    
    const detailImg = document.getElementById('detail-image');
    if (imgSrc) {
        detailImg.src = imgSrc;
        detailImg.style.display = 'block';
    } else {
        detailImg.src = '';
        detailImg.style.display = 'none';
    }
    
    const isCompleted = box.classList.contains('completed');
    const setBtn = document.getElementById('btn-set-item');
    setBtn.innerText = isCompleted ? '↩ UNSET' : '✓ SET COMPLETE';
    setBtn.style.background = isCompleted ? '#666' : '';
    
    document.getElementById('product-modal').classList.remove('hidden');
}

function closeProductModal(event) {
    if (event && event.target.id !== 'product-modal') return;
    document.getElementById('product-modal').classList.add('hidden');
    currentItemBox = null;
}

function setItemComplete() {
    if (!currentItemBox) return;
    
    const upc = currentItemBox.dataset.upc;
    const isCompleted = currentItemBox.classList.contains('completed');
    const currentItem = JSON.parse(currentItemBox.dataset.itemData);
    const currentPosition = parseInt(currentItem.Position) || 0;
    
    const currentPegMatch = currentItem.Peg ? currentItem.Peg.match(/R(\d+)/) : null;
    const currentRow = currentPegMatch ? parseInt(currentPegMatch[1]) : 0;
    
    if (isCompleted) {
        completedItems.delete(upc);
        currentItemBox.classList.remove('completed');
        localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
        const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
        const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
        updateProgress(items, done);
        document.getElementById('product-modal').classList.add('hidden');
        currentItemBox = null;
    } else {
        playCompleteSound();
        completedItems.add(upc);
        currentItemBox.classList.add('completed');
        localStorage.setItem('harpa_complete', JSON.stringify([...completedItems]));
        
        const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
        const done = items.filter(i => completedItems.has(i.CleanUPC)).length;
        updateProgress(items, done);
        
        const nextPosition = currentPosition + 1;
        const nextBox = findProductBoxByPosition(nextPosition);
        
        if (nextBox) {
            const nextItem = JSON.parse(nextBox.dataset.itemData);
            const nextPegMatch = nextItem.Peg ? nextItem.Peg.match(/R(\d+)/) : null;
            const nextRow = nextPegMatch ? parseInt(nextPegMatch[1]) : 0;
            
            if (nextRow > currentRow) {
                playRowChangeSound();
                showRowChangeToast(nextRow);
            }
            
            currentItemBox = null;
            openProductModal(nextBox);
        } else {
            document.getElementById('product-modal').classList.add('hidden');
            currentItemBox = null;
            checkBayCompletion(items, done);
        }
    }
}

function showRowChangeToast(row) {
    const toast = document.getElementById('row-toast');
    const toastText = document.getElementById('row-toast-text');
    
    // Reset animation by removing and re-adding class
    toast.classList.remove('show');
    toast.classList.add('hidden');
    
    // Force reflow to reset animation
    void toast.offsetWidth;
    
    toastText.innerText = `⬇️ Moving to Row ${row}`;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.add('hidden');
        toast.classList.remove('show');
    }, 2500);
}

function findProductBoxByPosition(position) {
    const boxes = document.querySelectorAll('.product-box');
    for (const box of boxes) {
        try {
            const itemData = JSON.parse(box.dataset.itemData);
            if (parseInt(itemData.Position) === position) return box;
        } catch (e) { }
    }
    return null;
}

function goToPreviousItem() {
    if (!currentItemBox) { closeProductModal(); return; }
    
    const currentItem = JSON.parse(currentItemBox.dataset.itemData);
    const currentPosition = parseInt(currentItem.Position) || 0;
    
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const sortedItems = items.sort((a, b) => (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0));
    
    // Find the previous item by position (regardless of completion status)
    let prevBox = null;
    for (let i = sortedItems.length - 1; i >= 0; i--) {
        const pos = parseInt(sortedItems[i].Position) || 0;
        if (pos < currentPosition) {
            prevBox = findProductBoxByPosition(pos);
            if (prevBox) break;
        }
    }
    
    // If no previous item in this bay, wrap to the last item
    if (!prevBox) {
        for (let i = sortedItems.length - 1; i >= 0; i--) {
            const pos = parseInt(sortedItems[i].Position) || 0;
            if (pos !== currentPosition) {
                prevBox = findProductBoxByPosition(pos);
                if (prevBox) break;
            }
        }
    }
    
    if (prevBox) { currentItemBox = null; openProductModal(prevBox); }
    else closeProductModal();
}

function skipToNextUnset() {
    if (!currentItemBox) { closeProductModal(); return; }
    
    const currentItem = JSON.parse(currentItemBox.dataset.itemData);
    const currentPosition = parseInt(currentItem.Position) || 0;
    
    const items = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === currentBay);
    const sortedItems = items.sort((a, b) => (parseInt(a.Position) || 0) - (parseInt(b.Position) || 0));
    
    let nextUnsetBox = null;
    for (const item of sortedItems) {
        const pos = parseInt(item.Position) || 0;
        if (pos > currentPosition && !completedItems.has(item.CleanUPC)) {
            nextUnsetBox = findProductBoxByPosition(pos);
            if (nextUnsetBox) break;
        }
    }
    
    if (!nextUnsetBox) {
        for (const item of sortedItems) {
            const pos = parseInt(item.Position) || 0;
            if (pos !== currentPosition && !completedItems.has(item.CleanUPC)) {
                nextUnsetBox = findProductBoxByPosition(pos);
                if (nextUnsetBox) break;
            }
        }
    }
    
    if (nextUnsetBox) { currentItemBox = null; openProductModal(nextUnsetBox); }
    else closeProductModal();
}

// === CELEBRATION SYSTEM ===
function checkBayCompletion(items, done) {
    if (items.length === 0) return;
    const bayKey = `${currentPOG}-${currentBay}`;
    
    if (done === items.length && !bayCompletionShown.has(bayKey)) {
        bayCompletionShown.add(bayKey);
        playCelebrationSound();
        showBayCompleteCelebration();
        setTimeout(() => checkPogCompletion(), 3500);
    }
}

function showBayCompleteCelebration() {
    document.getElementById('bay-complete-text').innerText = `Bay ${currentBay} is done!`;
    document.getElementById('bay-complete-overlay').classList.remove('hidden');
    setTimeout(() => document.getElementById('bay-complete-overlay').classList.add('hidden'), 3500);
}

function checkPogCompletion() {
    if (pogCompleteShown) return;
    const allItems = pogData.filter(i => i.POG === currentPOG);
    const allDone = allItems.filter(i => completedItems.has(i.CleanUPC)).length;
    
    if (allDone === allItems.length && allItems.length > 0) {
        pogCompleteShown = true;
        playPogCompleteSound();
        showPogCompleteCelebration(allItems.length);
    }
}

function showPogCompleteCelebration(totalItems) {
    document.getElementById('pog-complete-text').innerText = `All ${totalItems} items complete!`;
    document.getElementById('pog-complete-overlay').classList.remove('hidden');
    startConfetti();
    setTimeout(() => { document.getElementById('pog-complete-overlay').classList.add('hidden'); stopConfetti(); }, 5000);
}

let confettiAnimation = null;
function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const pieces = [];
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ffd700'];
    for (let i = 0; i < 150; i++) {
        pieces.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            size: Math.random() * 10 + 5,
            color: colors[Math.floor(Math.random() * colors.length)],
            speedY: Math.random() * 3 + 2,
            speedX: Math.random() * 2 - 1,
            rotation: Math.random() * 360
        });
    }
    
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces.forEach(p => {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation * Math.PI / 180);
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size * 0.6);
            ctx.restore();
            p.y += p.speedY; p.x += p.speedX; p.rotation += 5;
            if (p.y > canvas.height) { p.y = -p.size; p.x = Math.random() * canvas.width; }
        });
        confettiAnimation = requestAnimationFrame(animate);
    }
    animate();
}

function stopConfetti() {
    if (confettiAnimation) cancelAnimationFrame(confettiAnimation);
    confettiAnimation = null;
    const canvas = document.getElementById('confetti-canvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// === MINI-MAP ===
function openMinimap() {
    const modal = document.getElementById('minimap-modal');
    const container = document.getElementById('minimap-bays');
    container.innerHTML = '';
    
    const allItems = pogData.filter(i => i.POG === currentPOG);
    const allDone = allItems.filter(i => completedItems.has(i.CleanUPC)).length;
    const allPct = allItems.length > 0 ? Math.round((allDone / allItems.length) * 100) : 0;
    
    document.getElementById('minimap-total-progress').innerText = `${allDone}/${allItems.length} items`;
    document.getElementById('minimap-percent').innerText = `${allPct}%`;
    
    allBays.forEach(bayNum => {
        const bayItems = pogData.filter(i => i.POG === currentPOG && parseInt(i.Bay) === bayNum);
        const bayDone = bayItems.filter(i => completedItems.has(i.CleanUPC)).length;
        const bayPct = bayItems.length > 0 ? Math.round((bayDone / bayItems.length) * 100) : 0;
        
        const card = document.createElement('div');
        card.className = 'minimap-bay';
        if (bayNum === currentBay) card.classList.add('current');
        if (bayPct === 100) card.classList.add('complete');
        else if (bayPct > 0) card.classList.add('in-progress');
        
        card.innerHTML = `<div class="minimap-bay-number">${bayNum}</div><div class="minimap-bay-progress">${bayDone}/${bayItems.length}</div>`;
        card.onclick = () => { closeMinimap(); loadBay(bayNum, true); };
        container.appendChild(card);
    });
    
    modal.classList.remove('hidden');
}

function closeMinimap(event) {
    if (event && event.target.id !== 'minimap-modal') return;
    document.getElementById('minimap-modal').classList.add('hidden');
}

// === PDF VIEWER ===
function openPDF() {
    if (!currentPOG) {
        alert('No POG selected');
        return;
    }
    
    // Find PDF in fileIndex that ends with _{POG}.pdf
    const pdfFile = fileIndex.find(f => f.endsWith(`_${currentPOG}.pdf`));
    
    if (!pdfFile) {
        alert(`PDF not found for POG ${currentPOG}`);
        console.log('Looking for PDF ending with:', `_${currentPOG}.pdf`);
        console.log('Available PDFs:', fileIndex.filter(f => f.endsWith('.pdf')));
        return;
    }
    
    const pdfFrame = document.getElementById('pdf-frame');
    const pdfModal = document.getElementById('pdf-modal');
    
    if (pdfFrame && pdfModal) {
        pdfFrame.src = pdfFile;
        pdfModal.classList.remove('hidden');
    } else {
        console.error('PDF elements not found');
    }
}

function closePDF() {
    const pdfModal = document.getElementById('pdf-modal');
    const pdfFrame = document.getElementById('pdf-frame');
    
    if (pdfModal) pdfModal.classList.add('hidden');
    if (pdfFrame) pdfFrame.src = '';
}

// === HELP & SUPPORT ===
function openHelp() {
    document.getElementById('help-modal').classList.remove('hidden');
    // Pre-fill store number if available
    const storeInput = document.getElementById('help-store');
    if (storeInput && currentStore) {
        storeInput.value = currentStore;
    }
}

function closeHelp() {
    document.getElementById('help-modal').classList.add('hidden');
}

function submitHelpForm() {
    const name = document.getElementById('help-name').value.trim();
    const store = document.getElementById('help-store').value.trim();
    const issueType = document.getElementById('help-type').value;
    const message = document.getElementById('help-message').value.trim();
    
    // Validate
    if (!name || !store || !issueType || !message) {
        alert('Please fill in all fields');
        return;
    }
    
    // Build email
    const subject = encodeURIComponent(`PEGASUS ${issueType} - Store ${store}`);
    const body = encodeURIComponent(
`PEGASUS Feedback/Support Request
================================

Name: ${name}
Store: ${store}
Issue Type: ${issueType}
POG: ${currentPOG || 'N/A'}

Message:
${message}

--------------------------------
Sent from PEGASUS App`
    );
    
    // Open mail client
    window.location.href = `mailto:tyson.gauthier@retailodyssey.com?subject=${subject}&body=${body}`;
    
    // Show confirmation and clear form
    showToast('Opening email client...', 2000);
    
    // Clear form after short delay
    setTimeout(() => {
        document.getElementById('help-name').value = '';
        document.getElementById('help-type').value = '';
        document.getElementById('help-message').value = '';
        closeHelp();
    }, 1000);
}
