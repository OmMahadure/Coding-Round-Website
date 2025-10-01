
let currentQuestion = 1;       
let timeLeft = 2 * 60 * 60;    
let timerInterval;             
let lastExecutionTime = 0;
const EXECUTION_COOLDOWN = 2000;
let examStarted = false;       
let tabSwitchDetected = false; 
let preferredLanguage = 'cpp'; 
let terminal;
let inputEditor;
let visitedQuestions = new Set();    
let answeredQuestions = new Set();   


// ========================================
// QUESTIONS DATA
// ========================================


let codingQuestions = [];

// Function to load questions from JSON file
async function loadQuestionsFromJSON() {
    try {
        const response = await fetch('Backend/all_questions.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const questions = await response.json();
        codingQuestions = questions;
        console.log(`Successfully loaded ${questions.length} questions from JSON file`);
        return questions;
    } catch (error) {
        console.error('Failed to load questions from JSON file:', error);
        console.log('Falling back to empty questions array');
        codingQuestions = [];
        return [];
    }
}

// ========================================
// MONACO EDITOR INITIALIZATION
// ========================================

// Language-specific Monaco editor language IDs 
const languageMap = {
    python: 'python',
    cpp: 'cpp',
    java: 'java',
    javascript: 'javascript'
};

// Configure Monaco Editor paths
require.config({
    paths: {
        vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs'
    }
});


function initializeMonacoEditors() {
    require(['vs/editor/editor.main'], function () {
        inputEditor = new MonacoInput('monaco-editor', 'cpp');
        terminal = new MonacoTerminal('monaco-output');
    });
}

//Monaco Input Termial//

class MonacoInput {
    constructor(containerId, language = "cpp") {
        this.container = document.getElementById(containerId);
        this.editor = monaco.editor.create(this.container, {
            value: this.getDefaultCode(language),
            language: language,
            theme: "vs-dark",
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 14,
            wordWrap: "on"
        });
    }

    getValue() {
        return this.editor.getValue();
    }

    setValue(code) {
        this.editor.setValue(code);
    }

    setLanguage(language) {
        monaco.editor.setModelLanguage(this.editor.getModel(), language);
        this.setValue(this.getDefaultCode(language));
    }

    getDefaultCode(language) {
        const templates = {
            cpp: `#include <iostream>
using namespace std;

int main() {
cout << "Hello, World!" << endl;
return 0;
}`,
            java: `import java.util.Scanner;
public class Main {
public static void main(String[] args) 
{
System.out.println("Hello, World!");
}
}`,
            python: `print("Hello, World!")`,

            javascript: `console.log("Hello, World!");`
        };
        return templates[language] || "";
    }
}

//Monaco output Teminal//

class MonacoTerminal {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.outputBuffer = "";
        this.editor = monaco.editor.create(this.container, {
            value: "",
            language: "plaintext",
            theme: "vs-dark",
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 13,
            wordWrap: "on"
        });
    }

    clear() {
        this.outputBuffer = "";
        this.editor.setValue("");
    }

    println(text) {
        const needsNewline = this.outputBuffer.length > 0 && !this.outputBuffer.endsWith("\n");
        this.outputBuffer += (needsNewline ? "\n" : "") + text + "\n";
        this.editor.setValue(this.outputBuffer);
        this.scrollToBottom();
    }

    scrollToBottom() {
        const count = this.editor.getModel().getLineCount();
        this.editor.revealLine(count);
    }

    async prompt(promptText) {
        // Create a temporary input line
        this.outputBuffer += promptText;
        this.editor.setValue(this.outputBuffer);
        this.editor.updateOptions({ readOnly: false });
        this.scrollToBottom();

        
        const model = this.editor.getModel();
        const lastLine = model.getLineCount();
        const lastCol = model.getLineMaxColumn(lastLine);
        this.editor.setPosition({ lineNumber: lastLine, column: lastCol });
        this.editor.focus();

        return new Promise((resolve) => {
            const disposable = this.editor.onKeyDown((e) => {
                if (e.keyCode === monaco.KeyCode.Enter) {
                    e.preventDefault();

                    
                    const currentLastLine = model.getLineCount();
                    let lineText = model.getLineContent(currentLastLine);

                   
                    let inputValue = "";
                    if (lineText.startsWith(promptText)) {
                        inputValue = lineText.substring(promptText.length).trim();
                    } else {
                       
                        const idx = lineText.lastIndexOf(promptText);
                        inputValue = idx >= 0 ? lineText.substring(idx + promptText.length).trim() : lineText.trim();
                    }

                    this.outputBuffer += inputValue + "\n";
                    this.editor.setValue(this.outputBuffer);
                    this.editor.updateOptions({ readOnly: true });
                    this.scrollToBottom();
                    disposable.dispose();
                    resolve(inputValue);
                }
            });
        });
    }

    getOutput() {
        return this.outputBuffer;
    }

    setOutput(output) {
        this.outputBuffer = output;
        this.editor.setValue(output);
        this.scrollToBottom();
    }
}

// =================== JUDGE0 API ===================//

const JUDGE0_URL = "https://judge0-ce.p.rapidapi.com/submissions";
const JUDGE0_HEADERS = {
    "Content-Type": "application/json",
    "X-RapidAPI-Key": "your rapidapi key here",
    "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com"
};


const LANGUAGE_IDS = {
    cpp: 54,      // C++ (GCC 9.2.0)
    java: 62,     // Java (OpenJDK 13.0.1)
    python: 71,   // Python (3.8.1)
    javascript: 63 // JavaScript (Node.js 12.14.0)
};

async function executeJudge0(languageId, code, stdin = "") {
    try {
        // Create submission
        const createBody = {
            source_code: code,
            language_id: languageId,
            stdin: stdin,
            cpu_time_limit: 5,
            memory_limit: 512000,
            redirect_stderr_to_stdout: true
        };

        const createResponse = await fetch(JUDGE0_URL, {
            method: "POST",
            headers: JUDGE0_HEADERS,
            body: JSON.stringify(createBody)
        });

        if (!createResponse.ok) {
            throw new Error(`Failed to create submission: ${createResponse.status}`);
        }

        const submission = await createResponse.json();
        const token = submission.token;

       
        let result;
        let attempts = 0;
        const maxAttempts = 30;
        const waitTime = 1000; 

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, waitTime));
            attempts++;

            const getResponse = await fetch(`${JUDGE0_URL}/${token}?base64_encoded=false`, {
                method: "GET",
                headers: JUDGE0_HEADERS
            });

            if (!getResponse.ok) {
                throw new Error(`Failed to get submission result: ${getResponse.status}`);
            }

            result = await getResponse.json();

            // Status IDs: 1 (In Queue), 2 (Processing)
            if (result.status && result.status.id <= 2) continue;

            break;
        }

        if (attempts >= maxAttempts) {
            throw new Error("Execution timeout - submission took too long to complete");
        }
        const statusMap = {
            3: "Success",     
            4: "Wrong Answer", 
            5: "Time Limit Exceeded",
            6: "Compilation Error",
            7: "Runtime Error",
            8: "Memory Limit Exceeded",
            9: "Output Limit Exceeded"
        };

        return {
            ...result,
            statusName: statusMap[result.status?.id] || "Unknown Status"
        };
    } catch (error) {
        console.error("Judge0 API Error:", error);
        return {
            error: error.message,
            stdout: null,
            stderr: null,
            compile_output: null,
            statusName: "Service Error"
        };
    }
}

// ========================================
// TIMER FUNCTIONS
// ========================================


function updateTimer() {
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    const timeElement = document.getElementById('time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }
    if (timeLeft <= 0) {
        finishExam();
    } else {
        timeLeft--; 
    }
}

function startExam() {
    const userEmail = localStorage.getItem('userEmail');
    const userName = localStorage.getItem('userName');
    const registrationId = localStorage.getItem('registrationId');
    
    if (!userEmail || !userName || !registrationId) {
        alert('Missing user information. Please register first and then return to take the exam.');
        window.location.href = 'RagistrationPage.html';
        return;
    }
    
    examStarted = true;
    console.log("Exam started - tab switch detection is now active");
    resetTabSwitchDetection(); 
    timerInterval = setInterval(updateTimer, 1000);
    updateTimer(); 

    
    for (let i = 1; i <= codingQuestions.length; i++) {
        localStorage.removeItem(`question_${i}_code`);
        localStorage.removeItem(`question_${i}_output`);
    }
    
    if (terminal) {
        terminal.clear();
        terminal.println('Click "Run Code" to execute your program...');
    }

    if (inputEditor) {
        inputEditor.setValue(inputEditor.getDefaultCode(preferredLanguage));
        // Ensure proper language highlighting
        monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[preferredLanguage]);
    }
}

// ========================================
// QUESTION NAVIGATION FUNCTIONS
// ========================================


function goToQuestion(questionId) {
    
    if (questionId >= 1 && questionId <= codingQuestions.length) {
        saveCode();
        saveOutput();
        visitedQuestions.add(questionId);
        currentQuestion = questionId;
        const question = codingQuestions[questionId - 1];

        const questionContentDiv = document.querySelector('.question-content');
        if (questionContentDiv && question) {
            const testCasesHTML = question.testCases.map((testCase, index) => 
                `<li><strong>Test Case ${index + 1}:</strong> Input: <code>${testCase.input}</code> → Expected Output: <code>${testCase.expectedOutput}</code></li>`
            ).join('');

            questionContentDiv.innerHTML = `
                <h1><strong>Question <strong>${question.questionNumber}</h1>
                <h3>${question.title}</h3>
                <span>${question.description}</span>
                <div class="question-details">
                    <div class="question-info">
                        <p><strong>Difficulty:</strong> ${question.difficulty}</p>
                        <p><strong>Topic:</strong> ${question.topic}</p>
                    </div>
                    <h5>Test Cases:</h5>
                    <ul class="test-cases">
                    <h4>Note: ${question.note}</h4>
                        ${testCasesHTML}
                    </ul>
                </div>
            `;
        }
        loadCode(questionId);
        const savedLang = localStorage.getItem(`question_${questionId}_language`);
        const isSubmitted = answeredQuestions.has(questionId);
        const activeLangForQuestion = savedLang || preferredLanguage;
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.style.backgroundColor = 'rgb(11, 107, 252)';
        });
        
        const preferredBtn = document.getElementById(`btn-${activeLangForQuestion}`);
        if (preferredBtn) {
            preferredBtn.style.backgroundColor = 'rgb(0, 73, 183)';
        }
        
        updateQuestionNavigation(questionId);
        updateStatusCounters();
    }
}

function updateQuestionNavigation(activeQuestion) {
    const circles = document.querySelectorAll('.circle');

    circles.forEach((circle, index) => {
        const questionId = index + 1;
        circle.classList.remove('active', 'answered', 'visited');
        
        if (answeredQuestions.has(questionId)) {
            circle.classList.add('answered');        // Green - answered
        } else if (visitedQuestions.has(questionId)) {
            circle.classList.add('visited');         // Red - visited but not answered
        }
        if (questionId === activeQuestion) {
            circle.classList.add('active');          // Blue - current question
        }
    });
}

function updateStatusCounters() {
    const answeredCount = answeredQuestions.size;                    // Questions submitted
    const visitedCount = visitedQuestions.size - answeredQuestions.size;  // Visited but not answered
    const notVisitedCount = Math.max(0, codingQuestions.length - visitedQuestions.size); // Not seen yet

    document.getElementById('answeredCount').textContent = answeredCount;
    document.getElementById('visitedCount').textContent = visitedCount;
    document.getElementById('notVisitedCount').textContent = notVisitedCount;
}

function nextQuestion() {
    if (currentQuestion < codingQuestions.length) {
        goToQuestion(currentQuestion + 1);
    } else {
        alert('This is the last question.');
    }
}



// Submit current question answer
function submitAnswer() {
    if (inputEditor) {
        const code = inputEditor.getValue();
        console.log(`Submitting answer for question ${currentQuestion}:`, code);

        saveCode();
        saveOutput();

        answeredQuestions.add(currentQuestion);

        const circles = document.querySelectorAll('.circle');
        if (circles[currentQuestion - 1]) {
            circles[currentQuestion - 1].classList.add('answered');
        }

        updateStatusCounters();

        if (currentQuestion < codingQuestions.length) {
            goToQuestion(currentQuestion + 1);
        }
    }
}

// ========================================
// EXAM CONTROL FUNCTIONS
// ========================================


function finishExam(skipConfirmation = false) {
    if (skipConfirmation || confirm('Are you sure you want to finish the exam?')) {
        // Stop the timer and monitoring
        clearInterval(timerInterval);
        examStarted = false;
        stopFocusMonitoring();
        stopActivityMonitoring();


// *****************************
// GRADING AND CALCULATING SCORE
// *****************************
        
        const totalQuestions = codingQuestions.length; 
        const solvedQuestionsCount = answeredQuestions.size;
        const unsolvedQuestionsCount = totalQuestions - solvedQuestionsCount;

        function isAnswerCorrect(questionId) {
            const userCode = localStorage.getItem(`question_${questionId}_code`);
            const userOutput = localStorage.getItem(`question_${questionId}_output`);

            if (!userCode || !userOutput) {
                console.log(`Question ${questionId}: No code or output found`);
                return false;
            }

            const question = codingQuestions.find(q => q.questionNumber === questionId);
            if (!question || !question.testCases) {
                console.log(`Question ${questionId}: No question or test cases found`);
                return false;
            }

            const actualTestCases = question.testCases.filter(testCase => 
                testCase.input && testCase.expectedOutput && !testCase.note
            );

            if (actualTestCases.length === 0) {
                console.log(`Question ${questionId}: No valid test cases found`);
                return false;
            }

            const cleanUserOutput = userOutput.trim().replace(/\s+/g, ' ');
            const allExpectedOutputs = actualTestCases.map(testCase => 
                testCase.expectedOutput.trim()
            );

            console.log(`Question ${questionId} - User Output: "${cleanUserOutput}"`);
            console.log(`Question ${questionId} - Expected Outputs:`, allExpectedOutputs);
            const anyOutputMatches = allExpectedOutputs.some(expectedOutput => {

                if (cleanUserOutput.includes(expectedOutput)) {
                    console.log(`Question ${questionId} - Exact match found for: "${expectedOutput}"`);
                    return true;
                }
                
                if (cleanUserOutput.toLowerCase().includes(expectedOutput.toLowerCase())) {
                    console.log(`Question ${questionId} - Case-insensitive match found for: "${expectedOutput}"`);
                    return true;
                }

                const normalizedUserOutput = cleanUserOutput.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
                const normalizedExpected = expectedOutput.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
                
                if (normalizedUserOutput.includes(normalizedExpected)) {
                    console.log(`Question ${questionId} - Normalized match found for: "${expectedOutput}"`);
                    return true;
                }
                
                console.log(`Question ${questionId} - No match found for: "${expectedOutput}"`);
                return false;
            });

            console.log(`Question ${questionId} - Final Result: ${anyOutputMatches ? 'CORRECT' : 'INCORRECT'}`);
            return anyOutputMatches;
        }

        
        const correctAnswersCount = Array.from(answeredQuestions).filter(qId =>
            isAnswerCorrect(qId)
        ).length;

        const wrongAnswersCount = solvedQuestionsCount - correctAnswersCount;
        const totalScore = totalQuestions > 0 ? Math.round((correctAnswersCount / totalQuestions) * 100) : 0;
        const questionsAnalysis = codingQuestions.map(question => {
            const qId = question.questionNumber;
            const isAnswered = answeredQuestions.has(qId);
            
            if (isAnswered) {
                return {
                    questionId: qId,
                    status: isAnswerCorrect(qId) ? 'Correct' : 'Incorrect',
                    userCode: localStorage.getItem(`question_${qId}_code`) || '',
                    userOutput: localStorage.getItem(`question_${qId}_output`) || ''
                };
            } else {
                return {
                    questionId: qId,
                    status: 'Not Attempted',
                    userCode: '',
                    userOutput: ''
                };
            }
        });

        async function submitTestResults(results) {
            try {
                const response = await fetch("https://coding-round-website.onrender.com/api/user/results", {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(results),
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                console.log("Test results submitted successfully:", data);
                alert('Exam completed! Your answers have been submitted.');

                // Redirect to Dashboard
                window.location.href = 'Dashboard.html';

            } catch (error) {
                console.error("Failed to submit test results:", error);
                alert('An error occurred while submitting your test results.');
            }
        }

        const candidateEmail = localStorage.getItem('userEmail');
        const registrationId = localStorage.getItem('registrationId');

        if (!candidateEmail || !registrationId) {
            alert("Could not find user information. Cannot submit results.");
            window.location.href = 'Dashboard.html';
            return;
        }

        if (totalQuestions === 0) {
            alert("No questions were loaded. Cannot submit results.");
            window.location.href = 'Dashboard.html';
            return;
        }

        console.log('Submitting test results with data:', {
            candidateEmail,
            registrationId,
            totalQuestions,
            correctAnswersCount,
            wrongAnswersCount,
            unsolvedQuestionsCount,
            totalScore
        });

        const examLanguage = preferredLanguage || 'cpp';
        const languageName = examLanguage.charAt(0).toUpperCase() + examLanguage.slice(1);
        const results = {
            registrationId: registrationId,
            candidateEmail: candidateEmail,
            language: languageName,
            status: 'Completed',
            totalScore: totalScore,
            correctAnswers: correctAnswersCount,
            wrongAnswers: wrongAnswersCount,
            unsolvedQuestions: unsolvedQuestionsCount,
            questionsAnalysis: questionsAnalysis,
        };
        submitTestResults(results);
        if (inputEditor) {
            inputEditor.editor.updateOptions({ readOnly: true });
        }
    }
}

// ========================================
// INITIALIZATION
// ========================================

document.addEventListener('DOMContentLoaded', async function () {
    initializeMonacoEditors();
    await loadQuestionsFromJSON();
    if (codingQuestions.length > 0) {
        const totalQuestionsElement = document.getElementById('notVisitedCount');
        if (totalQuestionsElement) {
            totalQuestionsElement.textContent = codingQuestions.length;
        }
    }
    visitedQuestions.add(1);
    updateQuestionNavigation(1);
    updateStatusCounters();
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.style.backgroundColor = 'rgb(11, 107, 252)';
    });
    const defaultLangBtn = document.getElementById('btn-cpp');
    if (defaultLangBtn) {
        defaultLangBtn.style.backgroundColor = 'rgb(0, 73, 183)';
    }
    goToQuestion(1);
});

// Change programming language
function changeLanguage(lang) {
    if (!inputEditor) return;
    
    if (answeredQuestions && answeredQuestions.has(currentQuestion)) {
        const lockedLang = localStorage.getItem(`question_${currentQuestion}_language`) || lang;
        monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[lockedLang]);
        document.querySelectorAll('.lang-btn').forEach(btn => { btn.style.backgroundColor = 'rgb(11, 107, 252)'; });
        const lockedBtn = document.getElementById(`btn-${lockedLang}`);
        if (lockedBtn) lockedBtn.style.backgroundColor = 'rgb(0, 73, 183)';
        console.log(`Question ${currentQuestion} is submitted. Language locked to: ${lockedLang}`);
        return;
    }

    preferredLanguage = lang;
    if (examStarted) {
        preferredLanguage = lang;
        console.log(`Preferred language set to: ${lang} for all questions`);
    }
    
    monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[lang]);
    
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.style.backgroundColor = 'rgb(11, 107, 252)';
    });
    
    const activeBtn = document.getElementById(`btn-${lang}`);
    if (activeBtn) {
        activeBtn.style.backgroundColor = 'rgb(0, 73, 183)';
    }
    
    const template = inputEditor.getDefaultCode(lang);
    inputEditor.setValue(template);
    localStorage.setItem(`question_${currentQuestion}_language`, lang);
    localStorage.setItem(`question_${currentQuestion}_code`, template);
    
    console.log(`Language changed to: ${lang}`);
}

function runCode() {
    const now = Date.now();
    if (now - lastExecutionTime < EXECUTION_COOLDOWN) {
        if (terminal) {
            terminal.println(`Please wait ${Math.ceil((EXECUTION_COOLDOWN - (now - lastExecutionTime))/1000)} seconds before running again`);
        }
        return;
    }
    lastExecutionTime = now;

    const code = inputEditor.getValue();
    saveCode();

    if (preferredLanguage === "javascript") {
        executeJavaScript(code);
    } else if (preferredLanguage === "python") {
        executePython(code);
    } else if (preferredLanguage === "cpp") {
        executeCpp(code);
    } else if (preferredLanguage === "java") {
        executeJava(code);
    }
}


// ========================================
// CODE EXECUTION FUNCTIONS (OUTPUT TERMINAL)
// ========================================

async function executeCode(language, code) {
    const languageConfig = {
        cpp: {
            name: "C++",
            id: LANGUAGE_IDS.cpp,
            inputPatterns: [
                /cin\s*>>/g,
                /scanf\s*\([^)]*\)/g,
                /getline\s*\(/g,
                /std::getline/g
            ],
            action: "Compiling and executing",
            preprocessor: code => {
                // Ensure main function exists for C++
                if (!code.match(/int\s+main\s*\(/)) {
                    return `#include <iostream>\nusing namespace std;\n\n${code}\n\nint main() { return 0; }`;
                }
                return code;
            }
        },
        java: {
            name: "Java", 
            id: LANGUAGE_IDS.java,
            inputPatterns: [
                /new\s+Scanner\s*\(\s*System\.in\s*\)/g,
                /scanner\.next/g,
                /scanner\.nextLine/g,
                /scanner\.nextInt/g,
                /scanner\.nextDouble/g,
                /BufferedReader/g,
                /InputStreamReader/g
            ],
            action: "Compiling and executing",
            preprocessor: code => {
                // Ensure class declaration exists
                if (!code.match(/class\s+\w+/)) {
                    return `public class Main {\n    public static void main(String[] args) {\n        ${code}\n    }\n}`;
                }
                return code;
            }
        },
        python: {
            name: "Python",
            id: LANGUAGE_IDS.python, 
            inputPatterns: [
                /input\s*\(/g,
                /raw_input\s*\(/g,
                /sys\.stdin/g
            ],
            action: "Executing",
            preprocessor: code => code 
        },
        javascript: {
            name: "JavaScript",
            id: null,
            inputPatterns: [
                /prompt\s*\(/g,
                /confirm\s*\(/g,
                /window\.prompt/g,
                /readline\(\)/g,
                /process\.stdin/g
            ],
            action: "Executing",
            preprocessor: code => code 
        }
    };

    const config = languageConfig[language];
    if (!config) {
        terminal.println(`Unsupported language: ${language}`);
        return;
    }

    terminal.clear();
    terminal.println(`${config.action} ${config.name} code...\n`);
    let needsInput = false;
    let inputCount = 0;
    
    for (const pattern of config.inputPatterns) {
        const matches = code.match(pattern);
        if (matches) {
            needsInput = true;
            inputCount += matches.length;
        }
    }

    if (language === 'javascript') {
        needsInput = false;
        inputCount = 0;
    }

    let stdin = "";
    if (needsInput) {
    terminal.println(`Program requires ${inputCount} input(s).`);
    if (inputCount > 1) {
        terminal.println("Enter each input on a separate line:");
        for (let i = 0; i < inputCount; i++) {
            const input = await terminal.prompt(`Input ${i + 1}: `);
            stdin += input + "\n";
        }
    } else {
        stdin = await terminal.prompt("Enter input: ") + "\n";
    }
    }

    const loadingElement = document.createElement('div');
    loadingElement.className = 'loading-indicator';
    loadingElement.textContent = 'Executing code...';
    document.body.appendChild(loadingElement);
    
    //Local browser for JavaScript Execution//
    try {
        if (language === 'javascript') {
            const originalLog = console.log;
            const originalError = console.error;
            const originalWarn = console.warn;
            const toText = (args) => args.map(a => {
                if (typeof a === 'string') return a;
                try { return JSON.stringify(a); } catch { return String(a); }
            }).join(' ');
            console.log = (...args) => terminal.println("Output: " + toText(args));
            console.error = (...args) => terminal.println("Error: " + toText(args));
            console.warn = (...args) => terminal.println("Warning: " + toText(args));
            const originalPrompt = window.prompt;
            const originalConfirm = window.confirm;
            
            let inputQueue = [];
            if (stdin.trim()) {
                inputQueue = stdin.trim().split('\n');
            }
            
            window.prompt = (msg) => {
                const p = new Promise((resolve) => {
                    if (inputQueue.length > 0) {
                        const input = inputQueue.shift();
                        terminal.println(`${msg} ${input}`);
                        resolve(input);
                    } else {
                        terminal.prompt(msg + " ").then(resolve);
                    }
                });
                
                p.then((val) => {           });
                return p;
            };
            
            window.confirm = (msg) => {
                const p = new Promise((resolve) => {
                    if (inputQueue.length > 0) {
                        const input = inputQueue.shift();
                        terminal.println(`${msg} (y/n): ${input}`);
                        resolve(input.toLowerCase() === 'y' || input.toLowerCase() === 'yes');
                    } else {
                        terminal.prompt(msg + " (y/n): ").then((input) => {
                            resolve(input.toLowerCase() === 'y' || input.toLowerCase() === 'yes');
                        });
                    }
                });
                return p;
            };

            try {
                const result = await new Function(`
                    return (async () => {
                        try {
                            ${code}
                        } catch (error) {
                            throw error;
                        }
                    })();
                `)();
                if (result !== undefined) {
                    terminal.println("Return value: " + result);
                }
            } catch (err) {
                terminal.println(`Runtime Error: ${err.message}`);
                if (err.stack) {
                    terminal.println(`Stack trace: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
                }
            } finally {
                console.log = originalLog;
                console.error = originalError;
                console.warn = originalWarn;
                window.prompt = originalPrompt;
                window.confirm = originalConfirm;
    
                saveOutput();
            }
        } else {
            const processedCode = typeof config.preprocessor === 'function' ? config.preprocessor(code) : code;
            const result = await executeJudge0(config.id, processedCode, stdin);
            
            terminal.clear();
            terminal.println(`Execution Results:`);
            terminal.println("=================================");

            if (result.error) {
                terminal.println(`API Error: ${result.error}`);
                return;
            }

            terminal.println(`Status: ${result.statusName || 'Unknown'}`);
            
            if (result.stdout) {
                terminal.println("\nProgram Output:");
                terminal.println("---------------");
                terminal.println(result.stdout.trim());
            }
            
            if (result.stderr) {
                terminal.println("\nError Output:");
                terminal.println("-------------");
                terminal.println(result.stderr.trim());
            }
            
            if (result.compile_output) {
                terminal.println("\nCompilation Output:");
                terminal.println("-------------------");
                terminal.println(result.compile_output.trim());
            }
            
            if (!result.stdout && !result.stderr && !result.compile_output) {
                terminal.println("\n(No output produced)\nIf your program reads input, ensure you provided it when prompted.");
            }
            
            terminal.println("\n=================================");
            terminal.println("Execution completed");
            
            saveOutput();
        }
    } catch (error) {
        terminal.println(`\nExecution failed: ${error.message}`);
    } finally {
        if (loadingElement && document.body.contains(loadingElement)) {
            document.body.removeChild(loadingElement);
        }
    }
}

// Individual functions that call the unified function
async function executeCpp(code) {
    await executeCode('cpp', code);
}
async function executeJava(code) {
    await executeCode('java', code);
}
async function executePython(code) {
    await executeCode('python', code);
}
async function executeJavaScript(code) {
    await executeCode('javascript', code);
}


function clearOutput() {
    if (terminal) {
        terminal.clear();
    }
}

// ========================================
// CODE SAVE/LOAD FUNCTIONS
// ========================================

function saveCode() {
    if (inputEditor) {
        const code = inputEditor.getValue();
        localStorage.setItem(`question_${currentQuestion}_code`, code);
        localStorage.setItem(`question_${currentQuestion}_language`, preferredLanguage);
        console.log(`Auto-saved code for question ${currentQuestion}`);
    }
}

function saveOutput() {
    if (terminal && terminal.getOutput) {
        const output = terminal.getOutput();
        localStorage.setItem(`question_${currentQuestion}_output`, output);
        console.log(`Auto-saved output for question ${currentQuestion}`);
    }
}


function loadOutput(questionId) {
    const savedOutput = localStorage.getItem(`question_${questionId}_output`);
    if (terminal) {
        if (savedOutput && savedOutput.trim()) {
            terminal.setOutput(savedOutput);
        } else {
            terminal.clear();
            terminal.println('Click "Run Code" to execute your program...');
        }
    }
}


function loadCode(questionId) {
    const savedCode = localStorage.getItem(`question_${questionId}_code`);
    const savedLang = localStorage.getItem(`question_${questionId}_language`);
    if (inputEditor) {
        const langToUse = savedLang || preferredLanguage;
        monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[langToUse]);

        if (savedCode && savedCode !== '// WRITE YOUR CODE HERE') {
            inputEditor.setValue(savedCode);
        } else {
            inputEditor.setValue(inputEditor.getDefaultCode(langToUse));
        }
    }

    loadOutput(questionId);
}



// ===============================
// FULLSCREEN FUNCTIONALITY
// ===============================

function openFullscreen() {
    const elem = document.documentElement;
    
    if (elem.requestFullscreen) {
        elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) { // Safari
        elem.webkitRequestFullscreen();
    } else if (elem.msRequestFullscreen) { // IE/Edge
        elem.msRequestFullscreen();
    } else if (elem.mozRequestFullScreen) { // Firefox
        elem.mozRequestFullScreen();
    }
}

    document.addEventListener('DOMContentLoaded', function () {
        const modal = document.getElementById('fullscreen-modal');
        const btn = document.getElementById('start-fullscreen-btn');
        
        if (btn) {
            btn.addEventListener('click', function () {
                openFullscreen();
                if (modal) modal.style.display = 'none';
                startExam();
                goToQuestion(1);
            });
        }
    });


// ========================================
// SECURITY MEASURES
// ========================================

// Prevent screenshots, developer tools, and right-click
document.addEventListener("keydown", function (e) {
   
    if (e.key === "PrintScreen") {
        alert("Screenshot is disabled!");
        navigator.clipboard.writeText(" "); 
    }

    if (
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") || 
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") || 
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") || 
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") || 
        (e.ctrlKey && e.key.toLowerCase() === "u") || 
        (e.ctrlKey && e.key.toLowerCase() === "f") || 
        (e.ctrlKey && e.key.toLowerCase() === "v") || 
        (e.ctrlKey && e.key.toLowerCase() === "c") || 
        e.key === "Fn" ||
        e.key === "Tab" ||
        e.key === "Escape" ||
        e.key === "Alt" ||
        e.key === "Ctrl" ||
        e.key === "F12" ||
        e.key === "F11" ||
        e.key === "F10" ||
        e.key === "F9" ||
        e.key === "F8" ||
        e.key === "F7" ||
        e.key === "F6" ||
        e.key === "F5" ||
        e.key === "F4" ||
        e.key === "F3" ||
        e.key === "F2" ||
        e.key === "F1"
    ) {
        e.preventDefault();
        alert("Developer tools are disabled!");
    }
});

document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    alert("Right-click is disabled!");
});

// ===============================
// TAB SWITCH DETECTION
// ===============================

let lastFocusTime = Date.now();
let focusCheckInterval;


document.addEventListener("visibilitychange", () => {
    console.log("Visibility changed - hidden:", document.hidden, "state:", document.visibilityState, "examStarted:", examStarted, "tabSwitchDetected:", tabSwitchDetected);

    if (document.hidden && examStarted && !tabSwitchDetected) {
        console.log("Tab switch detected - terminating exam");
        tabSwitchDetected = true;
        alert("Tab switch detected. Your session will be terminated.");
        finishExam(true); 
        return;
    }
    if (document.visibilityState === 'hidden' && examStarted && !tabSwitchDetected) {
        console.log("Visibility state hidden detected - terminating exam");
        tabSwitchDetected = true;
        alert("Tab switch detected. Your session will be terminated.");
        finishExam(true);
    }
});

//Same browser tab switch detection//
window.addEventListener("pagehide", (event) => {
    if (examStarted && !tabSwitchDetected) {
        console.log("Page hide detected - terminating exam");
        tabSwitchDetected = true;
        finishExam(true);
    }
});

window.addEventListener("beforeunload", function (e) {
    if (examStarted) {
        saveCode(); // Save before leaving
        e.preventDefault();
        return 'Your exam is still in progress. Are you sure you want to leave?';
    }
});


window.addEventListener("blur", () => {
    if (examStarted && !tabSwitchDetected) {
        console.log("Window blur detected - starting focus monitoring");
        startFocusMonitoring();
    }
});

window.addEventListener("focus", () => {
    if (examStarted) {
        console.log("Window focus detected");
        lastFocusTime = Date.now();
        stopFocusMonitoring();
    }
});

function startFocusMonitoring() {
    if (focusCheckInterval) {
        clearInterval(focusCheckInterval);
    }

    focusCheckInterval = setInterval(() => {
        if (examStarted && !tabSwitchDetected) {
            const currentTime = Date.now();
            const timeSinceLastFocus = currentTime - lastFocusTime;

            if (timeSinceLastFocus > 2000 && !document.hasFocus()) {
                console.log("Focus monitoring detected tab switch - terminating exam");
                tabSwitchDetected = true;
                clearInterval(focusCheckInterval);
                alert("Tab switch detected. Your session will be terminated.");
                finishExam(true);
            }
        }
    }, 500);
}

function stopFocusMonitoring() {
    if (focusCheckInterval) {
        clearInterval(focusCheckInterval);
        focusCheckInterval = null;
    }
}

document.addEventListener("focusin", () => {
    if (examStarted) {
        lastFocusTime = Date.now();
        console.log("Document focus in detected");
    }
});

document.addEventListener("focusout", () => {
    if (examStarted && !tabSwitchDetected) {
        console.log("Document focus out detected - starting monitoring");
        startFocusMonitoring();
    }
});

document.addEventListener("mouseleave", () => {
    if (examStarted && !tabSwitchDetected) {
        console.log("Mouse leave detected - starting monitoring");
        startFocusMonitoring();
    }
});

function resetTabSwitchDetection() {
    tabSwitchDetected = false;
    lastFocusTime = Date.now();
    stopFocusMonitoring();
    startActivityMonitoring();
}

let lastActivityTime = Date.now();
let activityCheckInterval;

function startActivityMonitoring() {
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
    }

    lastActivityTime = Date.now();

    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'click', 'touchstart'];
    activityEvents.forEach(eventType => {
        document.addEventListener(eventType, () => {
            if (examStarted) {
                lastActivityTime = Date.now();
            }
        }, { passive: true });
    });

    activityCheckInterval = setInterval(() => {
        if (examStarted && !tabSwitchDetected) {
            const currentTime = Date.now();
            const timeSinceLastActivity = currentTime - lastActivityTime;

            if (document.hidden || !document.hasFocus()) {
                console.log("Periodic check detected tab switch - hidden:", document.hidden, "focused:", document.hasFocus());
                tabSwitchDetected = true;
                clearInterval(activityCheckInterval);
                alert("Tab switch detected. Your session will be terminated.");
                finishExam(true);
                return;
            }

            if (timeSinceLastActivity > 3000 && !document.hasFocus() && document.hidden) {
                console.log("Activity monitoring detected tab switch - terminating exam");
                tabSwitchDetected = true;
                clearInterval(activityCheckInterval);
                alert("Tab switch detected. Your session will be terminated.");
                finishExam(true);
            }
        }
    }, 1000);
}

function stopActivityMonitoring() {
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
        activityCheckInterval = null;
    }
}