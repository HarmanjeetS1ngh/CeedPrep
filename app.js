let rawDb = null;
let gkDb = null; // Flashcards Database
let currentExamData = []; 
let currentQIndex = 0;
let answers = {}; 
let userHistory = JSON.parse(localStorage.getItem('designExamHistory')) || [];

// Flashcards State
let flashcardsList = [];
let currentFcIndex = 0;
let isFlipped = false;
let suppressNextCardClick = false; // prevents the browser's synthetic click-after-touchend from double-flipping

// Timer Variables
let timerInterval = null;
let timeRemaining = 0; 

// DOM Elements
const views = {
    dashboard: document.getElementById('dashboard-view'),
    exam: document.getElementById('exam-view'),
    flashcard: document.getElementById('flashcard-view'),
    results: document.getElementById('results-view')
};

window.onload = async () => {
    try {
        // Load Exam Database
        const resExam = await fetch('design_master_database_LINKED.json');
        rawDb = await resExam.json();

        // Load Flashcards Database
        const resGk = await fetch('gk_flashcards_database.json');
        gkDb = await resGk.json();

        buildDashboard();
    } catch (e) {
        console.error("Database load error:", e);
        document.getElementById('dash-total-attempted').innerText = "ERROR loading files";
    }
};

// Global Keyboard Navigation for Flashcards
document.addEventListener('keydown', (e) => {
    if (views.flashcard.classList.contains('active')) {
        if (e.code === 'Space') {
            e.preventDefault();
            flipCard();
        } else if (e.code === 'ArrowRight') {
            nextFlashcard();
        } else if (e.code === 'ArrowLeft') {
            prevFlashcard();
        }
    }
});

// ================= FLASHCARD LOGIC =================
function initFlashcards() {
    if (!gkDb || !gkDb.flashcards || gkDb.flashcards.length === 0) {
        alert("Flashcard database is missing or empty.");
        return;
    }

    flashcardsList = [...gkDb.flashcards];
    currentFcIndex = 0;
    isFlipped = false;

    switchView('flashcard');
    renderFlashcard();
}

function renderFlashcard() {
    if (flashcardsList.length === 0) return;

    const card = flashcardsList[currentFcIndex];
    const cardEl = document.getElementById('main-flashcard');

    // Reset flip state silently
    cardEl.classList.remove('flipped');
    isFlipped = false;
    cardEl.style.transform = ''; 

    // Counter
    document.getElementById('fc-progress').innerText = `Card ${currentFcIndex + 1} of ${flashcardsList.length}`;

    // Front details
    document.getElementById('fc-topic-front').innerText = card.main_topic || "General Knowledge";
    document.getElementById('fc-source-front').innerText = `${card.source_exam || ''} ${card.source_year || ''}`;
    
    const promptText = card.content.context ? card.content.context : "No question text available.";
    document.getElementById('fc-question-text').innerText = promptText;

    // Image logic
    const imgEl = document.getElementById('fc-image');
    if (card.media_path && card.media_type !== 'none') {
        imgEl.src = card.media_path;
        imgEl.style.display = 'block';
    } else {
        imgEl.style.display = 'none';
        imgEl.src = "";
    }

    // Back details (Answer)
    const ansArray = card.content.correct_answer || [];
    document.getElementById('fc-answer-text').innerText = ansArray.join(', ');

    // Options breakdown (Front)
    const optionsBox = document.getElementById('fc-options-front');
    if (card.content.options && card.content.options.length > 0) {
        optionsBox.style.display = 'flex';
        optionsBox.innerHTML = card.content.options.map(opt => 
            `<div class="fc-option-item">${opt}</div>`
        ).join('');
    } else {
        optionsBox.style.display = 'none';
        optionsBox.innerHTML = '';
    }

    adjustCardScale(card);
}

// RESTORED: Absolute core function to handle the flip state securely
function flipCard() {
    if (isSwiping) return;

    isFlipped = !isFlipped;
    const cardEl = document.getElementById('main-flashcard');
    
    if (isFlipped) {
        cardEl.classList.add('flipped');
    } else {
        cardEl.classList.remove('flipped');
    }
}

// Click handler for the card
function handleCardClick() {
    if (suppressNextCardClick) return;
    flipCard();
}

function shuffleFlashcards() {
    for (let i = flashcardsList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [flashcardsList[i], flashcardsList[j]] = [flashcardsList[j], flashcardsList[i]];
    }
    currentFcIndex = 0;
    renderFlashcard();
}

// ================= DASHBOARD LOGIC =================
function buildDashboard() {
    switchView('dashboard');
    updateGlobalAnalytics();

    const topicMap = {};
    const papersContainer = document.getElementById('papers-grid');
    const topicsContainer = document.getElementById('topic-grid');
    papersContainer.innerHTML = '';
    topicsContainer.innerHTML = '';

    rawDb.papers.forEach((paper, pIdx) => {
        // Determine type class for specific card styling
        let examTypeClass = '';
        const examLabel = paper.exam.toUpperCase();
        if (examLabel === 'CEED') {
            examTypeClass = 'card-ceed';
        } else if (examLabel === 'UCEED') {
            examTypeClass = 'card-uceed';
        }

        const pCard = document.createElement('div');
        pCard.className = `action-card ${examTypeClass}`;
        pCard.innerHTML = `
            <div>
                <h3>${paper.exam} ${paper.year}</h3>
                <span class="meta-tag">${paper.questions.length} Questions</span>
            </div>
            <button class="btn-primary" onclick="initiateExam('paper', ${pIdx})">Start Exam</button>
        `;
        papersContainer.appendChild(pCard);

        paper.questions.forEach(q => {
            const topic = q.main_topic || "General";
            if (!topicMap[topic]) topicMap[topic] = [];
            topicMap[topic].push(q);
        });
    });

    Object.keys(topicMap).forEach(topic => {
        const tCard = document.createElement('div');
        tCard.className = 'action-card';
        tCard.innerHTML = `
            <div>
                <h3>${topic}</h3>
                <span class="meta-tag">${topicMap[topic].length} Questions Available</span>
            </div>
            <button class="btn-primary" onclick="initiateExam('topic', '${topic}')">Practice Topic</button>
        `;
        topicsContainer.appendChild(tCard);
    });
}

function updateGlobalAnalytics() {
    if (userHistory.length === 0) return;

    let totalQ = 0, totalCorrect = 0, topicErrors = {};

    userHistory.forEach(record => {
        totalQ += record.total;
        totalCorrect += record.correct;
        
        record.errors.forEach(err => {
            topicErrors[err.topic] = (topicErrors[err.topic] || 0) + 1;
        });
    });

    const avgAcc = ((totalCorrect / totalQ) * 100).toFixed(1);
    document.getElementById('dash-total-attempted').innerText = totalQ;
    document.getElementById('stat-tests-taken').innerText = userHistory.length;
    document.getElementById('stat-accuracy').innerText = `${avgAcc}%`;

    const sortedErrors = Object.keys(topicErrors).sort((a, b) => topicErrors[b] - topicErrors[a]);
    document.getElementById('stat-weak-topic').innerText = sortedErrors.length ? sortedErrors[0] : "None!";
}

// ================= TIMER LOGIC =================
function startTimer(minutes) {
    clearInterval(timerInterval);
    timeRemaining = minutes * 60;
    updateTimerDisplay();

    timerInterval = setInterval(() => {
        timeRemaining--;
        updateTimerDisplay();

        if (timeRemaining <= 0) {
            clearInterval(timerInterval);
            alert("⏰ Time is up! Your exam is being automatically submitted.");
            evaluateExam();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    document.getElementById('timer').innerText = 
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// ================= EXAM LOGIC =================
function initiateExam(mode, identifier) {
    let rawQuestions = [];
    let title = "";
    let durationMinutes = 60;

    if (mode === 'paper') {
        const paper = rawDb.papers[identifier];
        rawQuestions = paper.questions;
        title = `${paper.exam} ${paper.year}`;
        
        if (paper.exam.toUpperCase() === 'CEED') {
            durationMinutes = 60;
        } else if (paper.exam.toUpperCase() === 'UCEED') {
            durationMinutes = 120;
        }
    } else if (mode === 'topic') {
        rawDb.papers.forEach(p => {
            const filtered = p.questions.filter(q => q.main_topic === identifier);
            rawQuestions = rawQuestions.concat(filtered);
        });
        title = `${identifier} Practice`;
        durationMinutes = rawQuestions.length * 2; 
    }

    currentExamData = rawQuestions;
    answers = {};
    currentExamData.forEach((_, idx) => answers[idx] = { status: 'not-vis', value: null });

    document.getElementById('exam-title-display').innerText = title;
    switchView('exam');
    currentQIndex = 0;
    
    startTimer(durationMinutes);
    renderPalette();
    loadQuestion(0);
}

function loadQuestion(index) {
    if (index < 0 || index >= currentExamData.length) return;
    
    if (answers[currentQIndex].status === 'not-vis') answers[currentQIndex].status = 'not-ans';
    currentQIndex = index;
    if (answers[index].status === 'not-vis') answers[index].status = 'not-ans';

    const q = currentExamData[index];
    
    document.getElementById('q-type-label').innerText = `Type: ${q.question_type.toUpperCase().replace('_', ' ')}`;
    document.getElementById('q-marks-label').innerText = `Marks: +${q.marks_positive} | -${q.marks_negative}`;
    document.getElementById('q-number-display').innerText = `Question No. ${index + 1}`;
    
    const textEl = document.getElementById('q-text');
    textEl.innerHTML = q.content.context ? q.content.context.replace(/\n/g, '<br>') : "";

    const imgEl = document.getElementById('q-image');
    if (q.media_path && q.media_type !== 'none') {
        imgEl.src = q.media_path;
        imgEl.style.display = 'block';
    } else {
        imgEl.style.display = 'none';
        imgEl.src = "";
    }

    const inputArea = document.getElementById('q-input-area');
    inputArea.innerHTML = ''; 

    if (q.question_type === 'numerical') {
        inputArea.innerHTML = `<input type="number" step="any" class="nat-input" id="nat-val" placeholder="Enter numerical answer" value="${answers[index].value || ''}">`;
    } else {
        const inputType = q.question_type === 'multiple_choice' ? 'radio' : 'checkbox';
        (q.content.options || []).forEach((opt, i) => {
            const isChecked = answers[index].value && answers[index].value.includes(opt) ? 'checked' : '';
            inputArea.innerHTML += `
                <label class="option-row" for="opt${i}">
                    <input type="${inputType}" name="q-opt" value="${opt}" id="opt${i}" ${isChecked}>
                    <span>${opt}</span>
                </label>
            `;
        });
    }

    renderPalette();
}

function getCurrentValue() {
    const q = currentExamData[currentQIndex];
    if (q.question_type === 'numerical') {
        const val = document.getElementById('nat-val').value;
        return val ? [val] : null; 
    } else {
        const checked = Array.from(document.querySelectorAll('input[name="q-opt"]:checked')).map(el => el.value);
        return checked.length > 0 ? checked : null;
    }
}

function saveAndNext() {
    const val = getCurrentValue();
    answers[currentQIndex] = { status: val ? 'ans' : 'not-ans', value: val };
    if (currentQIndex < currentExamData.length - 1) loadQuestion(currentQIndex + 1);
    else renderPalette(); 
}

function markForReview() {
    answers[currentQIndex] = { status: 'rev', value: getCurrentValue() };
    if (currentQIndex < currentExamData.length - 1) loadQuestion(currentQIndex + 1);
    else renderPalette();
}

function clearResponse() {
    answers[currentQIndex] = { status: 'not-ans', value: null };
    loadQuestion(currentQIndex); 
}

function renderPalette() {
    const grid = document.getElementById('palette-grid');
    grid.innerHTML = '';
    
    let counts = { ans: 0, 'not-ans': 0, 'not-vis': 0, rev: 0 };
    
    currentExamData.forEach((q, idx) => {
        const status = answers[idx].status;
        counts[status]++;
        
        const btn = document.createElement('button');
        btn.className = `pal-btn ${status}`;
        btn.innerText = idx + 1;
        btn.onclick = () => loadQuestion(idx);
        grid.appendChild(btn);
    });

    document.querySelector('.badge.ans').innerText = counts.ans;
    document.querySelector('.badge.not-ans').innerText = counts['not-ans'];
    document.querySelector('.badge.not-vis').innerText = counts['not-vis'];
    document.querySelector('.badge.rev').innerText = counts.rev;
}

function toggleMobilePalette() {
    document.getElementById('side-palette').classList.toggle('open');
}

// ================= ANALYTICS & RESULTS =================
function finishExam() {
    if(confirm("Are you sure you want to submit the exam for evaluation?")) {
        evaluateExam();
    }
}

function evaluateExam() {
    clearInterval(timerInterval);

    let score = 0, correct = 0, incorrect = 0, unattempted = 0;
    let errors = [];

    currentExamData.forEach((q, idx) => {
        const userAns = answers[idx].value;
        const status = answers[idx].status;
        const correctAns = q.content.correct_answer; 

        if (status === 'not-vis' || status === 'not-ans' || !userAns) {
            unattempted++;
        } else {
            let isCorrect = false;
            
            if (q.question_type === 'numerical') {
                const uNum = parseFloat(userAns[0]);
                isCorrect = correctAns.some(ca => parseFloat(ca) === uNum);
            } else {
                const sortedUser = [...userAns].sort().join(',');
                const sortedCorrect = [...correctAns].sort().join(',');
                isCorrect = (sortedUser === sortedCorrect);
            }

            if (isCorrect) {
                correct++;
                score += q.marks_positive;
            } else {
                incorrect++;
                score -= Math.abs(q.marks_negative);
                errors.push({ 
                    topic: q.main_topic || "General", 
                    subtopic: q.subtopic || "Mixed" 
                });
            }
        }
    });

    userHistory.push({
        date: new Date().toISOString(),
        score: score,
        correct: correct,
        total: currentExamData.length,
        errors: errors
    });
    localStorage.setItem('designExamHistory', JSON.stringify(userHistory));

    document.getElementById('res-score').innerText = score.toFixed(2);
    document.getElementById('res-accuracy').innerText = `${((correct / (correct + incorrect || 1)) * 100).toFixed(1)}%`;
    document.getElementById('res-correct').innerText = correct;
    document.getElementById('res-incorrect').innerText = incorrect;
    document.getElementById('res-unattempted').innerText = unattempted;

    const errorList = document.getElementById('res-errors-list');
    errorList.innerHTML = '';
    
    const errorMap = {};
    errors.forEach(e => errorMap[e.topic] = (errorMap[e.topic] || 0) + 1);
    
    Object.keys(errorMap).forEach(topic => {
        errorList.innerHTML += `<li><span>${topic}</span> <span>${errorMap[topic]} wrong</span></li>`;
    });

    if (errors.length === 0) errorList.innerHTML = `<li><span style="color:var(--status-ans)">Perfect Score! No errors.</span></li>`;

    switchView('results');
}

function returnToDashboard() {
    buildDashboard();
}

function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    views[viewName].classList.add('active');
}

// ================= FLASHCARD THEME LOGIC =================
let isFcDarkMode = localStorage.getItem('fcDarkMode') === 'true';

function applyFcTheme() {
    const fcView = document.getElementById('flashcard-view');
    const themeBtn = document.getElementById('fc-theme-btn');
    
    if (isFcDarkMode) {
        fcView.classList.add('fc-dark');
        if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-sun fa-fw"></i>';
    } else {
        fcView.classList.remove('fc-dark');
        if (themeBtn) themeBtn.innerHTML = '<i class="fas fa-moon fa-fw"></i>';
    }
}

function toggleFCDarkMode() {
    isFcDarkMode = !isFcDarkMode;
    localStorage.setItem('fcDarkMode', isFcDarkMode);
    applyFcTheme();
}

document.addEventListener('DOMContentLoaded', applyFcTheme);

// ================= SNAPPY GESTURE & FLIP ENGINE =================
let touchstartX = 0;
let touchstartY = 0;
let currentX = 0;
let isSwiping = false;

document.addEventListener('touchstart', e => {
    if (!views.flashcard.classList.contains('active')) return;
    touchstartX = e.changedTouches[0].screenX;
    touchstartY = e.changedTouches[0].screenY;
    currentX = touchstartX;
    isSwiping = false;
}, { passive: true });

document.addEventListener('touchmove', e => {
    if (!views.flashcard.classList.contains('active')) return;
    currentX = e.changedTouches[0].screenX;
    const currentY = e.changedTouches[0].screenY;
    const xDiff = currentX - touchstartX;
    const yDiff = currentY - touchstartY;

    if (Math.abs(xDiff) > 20 && Math.abs(xDiff) > Math.abs(yDiff)) {
        isSwiping = true;
    }
}, { passive: true });

document.addEventListener('touchend', e => {
    if (!views.flashcard.classList.contains('active')) return;
    const xDiff = currentX - touchstartX;

    if (isSwiping && Math.abs(xDiff) > 40) {
        const direction = xDiff > 0 ? 'right' : 'left';
        animateSwipe(direction);
    } else if (!isSwiping) {
        if (e.target.closest('.flash-card')) {
            suppressNextCardClick = true;
            setTimeout(() => { suppressNextCardClick = false; }, 400);
            flipCard();
        }
    }

    setTimeout(() => {
        isSwiping = false; 
    }, 50);
}, { passive: true });

function animateSwipe(direction) {
    const cardEl = document.getElementById('main-flashcard');
    
    cardEl.style.transition = 'transform 0.15s ease, opacity 0.15s ease';
    cardEl.style.transform = `translateX(${direction === 'right' ? '30px' : '-30px'})`;
    cardEl.style.opacity = '0';

    setTimeout(() => {
        if (direction === 'left' && currentFcIndex < flashcardsList.length - 1) {
            currentFcIndex++;
        } else if (direction === 'right' && currentFcIndex > 0) {
            currentFcIndex--;
        }
        
        renderFlashcard();
        
        cardEl.style.transition = 'none';
        cardEl.style.transform = `translateX(${direction === 'left' ? '-30px' : '30px'})`;

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                cardEl.style.transition = 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease';
                cardEl.style.transform = 'translateX(0)';
                cardEl.style.opacity = '1';

                const clearInlineTransform = (ev) => {
                    if (ev.propertyName !== 'transform') return; 
                    cardEl.style.transform = '';
                    cardEl.removeEventListener('transitionend', clearInlineTransform);
                };
                cardEl.addEventListener('transitionend', clearInlineTransform);
            });
        });
    }, 150); 
}

function nextFlashcard() { if (currentFcIndex < flashcardsList.length - 1) animateSwipe('left'); }
function prevFlashcard() { if (currentFcIndex > 0) animateSwipe('right'); }

function adjustCardScale(card) {
    const bodyFront = document.querySelector('.card-front .fc-body');
    if (!bodyFront) return;
    const optionsText = (card.content.options || []).join('');
    const contextText = card.content.context || '';
    const totalChars = contextText.length + optionsText.length;

    bodyFront.classList.remove('scale-md', 'scale-sm');

    if (totalChars > 350 || (card.content.options && card.content.options.length > 4)) {
        bodyFront.classList.add('scale-sm'); 
    } else if (totalChars > 200 || card.media_path) {
        bodyFront.classList.add('scale-md'); 
    }
}