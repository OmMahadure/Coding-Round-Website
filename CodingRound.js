
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
// Question tracking sets
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

// Language-specific Monaco editor language IDs (moved to top to avoid reference errors)
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

// Initialize Monaco editors after DOM is loaded
function initializeMonacoEditors() {
    require(['vs/editor/editor.main'], function () {
        inputEditor = new MonacoInput('monaco-editor', 'cpp');
        terminal = new MonacoTerminal('monaco-output');
    });
}

//monaco input

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

//monaco output

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

        // Move caret to end of the last line so typing happens after the prompt
        const model = this.editor.getModel();
        const lastLine = model.getLineCount();
        const lastCol = model.getLineMaxColumn(lastLine);
        this.editor.setPosition({ lineNumber: lastLine, column: lastCol });
        this.editor.focus();

        return new Promise((resolve) => {
            const disposable = this.editor.onKeyDown((e) => {
                if (e.keyCode === monaco.KeyCode.Enter) {
                    e.preventDefault();

                    // Read from the current last line to avoid stale cursor issues
                    const currentLastLine = model.getLineCount();
                    let lineText = model.getLineContent(currentLastLine);

                    // Extract the portion after the prompt text
                    let inputValue = "";
                    if (lineText.startsWith(promptText)) {
                        inputValue = lineText.substring(promptText.length).trim();
                    } else {
                        // Fallback: try to find prompt within the line, else take whole line
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

// =================== JUDGE0 API ===================
const JUDGE0_URL = "https://judge0-ce.p.rapidapi.com/submissions";
const JUDGE0_HEADERS = {
    "Content-Type": "application/json",
    "X-RapidAPI-Key": "b3d8964b7dmsh5508a324f6c801ep17a737jsncd4ce6525772",
    "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com"
};

// Updated language IDs for Judge0 API
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

        // Wait for submission to complete
        let result;
        let attempts = 0;
        const maxAttempts = 30;
        const waitTime = 1000; // 1 second

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

        // Handle different statuses
        const statusMap = {
            3: "Success",      // Accepted
            4: "Wrong Answer", // Wrong Answer
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

// Update timer display every second
function updateTimer() {
    // Calculate hours, minutes, seconds
    const hours = Math.floor(timeLeft / 3600);
    const minutes = Math.floor((timeLeft % 3600) / 60);
    const seconds = timeLeft % 60;

    // Format time as HH:MM:SS
    const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    // Update timer display
    const timeElement = document.getElementById('time');
    if (timeElement) {
        timeElement.textContent = timeString;
    }

    // Check if time is up
    if (timeLeft <= 0) {
        finishExam();
    } else {
        timeLeft--; // Decrease time by 1 second
    }
}

// Start the exam and timer
function startExam() {
    // Check if user has required data
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
    resetTabSwitchDetection(); // Reset tab switch detection
    timerInterval = setInterval(updateTimer, 1000); // Update every second
    updateTimer(); // Update immediately

    

    // Clear all saved code and output for all questions when starting new exam
    for (let i = 1; i <= codingQuestions.length; i++) {
        localStorage.removeItem(`question_${i}_code`);
        localStorage.removeItem(`question_${i}_output`);
    }
    

    // Clear output terminal
    if (terminal) {
        terminal.clear();
        terminal.println('Click "Run Code" to execute your program...');
    }

    // Set default language template in Monaco editor
    if (inputEditor) {
        inputEditor.setValue(inputEditor.getDefaultCode(preferredLanguage));
        // Ensure proper language highlighting
        monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[preferredLanguage]);
    }
}

// ========================================
// QUESTION NAVIGATION FUNCTIONS
// ========================================

// Go to a specific question number
function goToQuestion(questionId) {
    // Check if question number is valid
    if (questionId >= 1 && questionId <= codingQuestions.length) {
        // Auto-save current question's code and output
        saveCode();
        saveOutput();
        
        visitedQuestions.add(questionId);
        currentQuestion = questionId;

        // Get question from the loaded JSON data
        const question = codingQuestions[questionId - 1];

        const questionContentDiv = document.querySelector('.question-content');
        if (questionContentDiv && question) {
            // Format test cases as a list
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

        // Load saved code/output and honor submitted state
        loadCode(questionId);

        // Determine active language for this question
        const savedLang = localStorage.getItem(`question_${questionId}_language`);
        const isSubmitted = answeredQuestions.has(questionId);
        const activeLangForQuestion = savedLang || preferredLanguage;

        // Update button styles to show active language for this question
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
// Update question navigation circle colors
function updateQuestionNavigation(activeQuestion) {
    const circles = document.querySelectorAll('.circle');

    circles.forEach((circle, index) => {
        const questionId = index + 1;

        // Remove all status classes
        circle.classList.remove('active', 'answered', 'visited');

        // Add appropriate status class based on question state
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

    // Update the status counter numbers
function updateStatusCounters() {
    const answeredCount = answeredQuestions.size;                    // Questions submitted
    const visitedCount = visitedQuestions.size - answeredQuestions.size;  // Visited but not answered
    const notVisitedCount = Math.max(0, codingQuestions.length - visitedQuestions.size); // Not seen yet

    // Update display
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

        // Save current question's code and output before marking as answered
        saveCode();
        saveOutput();

        // Mark current question as answered
        answeredQuestions.add(currentQuestion);

        // Update circle color to green (answered)
        const circles = document.querySelectorAll('.circle');
        if (circles[currentQuestion - 1]) {
            circles[currentQuestion - 1].classList.add('answered');
        }

        // Update status counters
        updateStatusCounters();

        // Automatically go to next question after submission
        if (currentQuestion < codingQuestions.length) {
            goToQuestion(currentQuestion + 1);
        }
    }
}

// ========================================
// EXAM CONTROL FUNCTIONS
// ========================================

// Replace your existing finishExam() function with this one
function finishExam(skipConfirmation = false) {
    if (skipConfirmation || confirm('Are you sure you want to finish the exam?')) {
        // Stop the timer and monitoring
        clearInterval(timerInterval);
        examStarted = false;
        stopFocusMonitoring();
        stopActivityMonitoring();


        /////////////////////////////////
        //GRADING AND CALCULATING SCORE//
        /////////////////////////////////
        
        const totalQuestions = codingQuestions.length; // Dynamically get from loaded questions array
        const solvedQuestionsCount = answeredQuestions.size;
        const unsolvedQuestionsCount = totalQuestions - solvedQuestionsCount;

        // Helper function to check if an answer is correct
        function isAnswerCorrect(questionId) {
            const userCode = localStorage.getItem(`question_${questionId}_code`);
            const userOutput = localStorage.getItem(`question_${questionId}_output`);

            if (!userCode || !userOutput) {
                console.log(`Question ${questionId}: No code or output found`);
                return false;
            }

            // Get the question and its test cases
            const question = codingQuestions.find(q => q.questionNumber === questionId);
            if (!question || !question.testCases) {
                console.log(`Question ${questionId}: No question or test cases found`);
                return false;
            }

            // Filter out the note test case and get actual test cases
            const actualTestCases = question.testCases.filter(testCase => 
                testCase.input && testCase.expectedOutput && !testCase.note
            );

            if (actualTestCases.length === 0) {
                console.log(`Question ${questionId}: No valid test cases found`);
                return false;
            }

            // Clean user output (remove extra whitespace, newlines, etc.)
            const cleanUserOutput = userOutput.trim().replace(/\s+/g, ' ');

            // Get all expected outputs from test cases
            const allExpectedOutputs = actualTestCases.map(testCase => 
                testCase.expectedOutput.trim()
            );

            console.log(`Question ${questionId} - User Output: "${cleanUserOutput}"`);
            console.log(`Question ${questionId} - Expected Outputs:`, allExpectedOutputs);

            // Check if user output matches ANY of the expected outputs
            // For a question to be correct, the user's output should contain at least one expected output
            const anyOutputMatches = allExpectedOutputs.some(expectedOutput => {
                // Try exact match first
                if (cleanUserOutput.includes(expectedOutput)) {
                    console.log(`Question ${questionId} - Exact match found for: "${expectedOutput}"`);
                    return true;
                }
                
                // Try case-insensitive match
                if (cleanUserOutput.toLowerCase().includes(expectedOutput.toLowerCase())) {
                    console.log(`Question ${questionId} - Case-insensitive match found for: "${expectedOutput}"`);
                    return true;
                }
                
                // Try matching after removing common formatting differences
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

        // Create detailed questions analysis for all questions
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

        //up-todown
        async function submitTestResults(results) {
            try {
                const response = await fetch("http://localhost:5000/api/test-results", {
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

        // Fetch candidate details from localStorage or a global variable if available
        const candidateEmail = localStorage.getItem('userEmail'); // Or however you store it
        const registrationId = localStorage.getItem('registrationId'); // From registration success

        if (!candidateEmail || !registrationId) {
            alert("Could not find user information. Cannot submit results.");
            window.location.href = 'Dashboard.html';
            return;
        }

        // Validate that we have actual results to submit
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

        // Determine exam name based on the language used
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

        // Call the new function to send results to the server
        submitTestResults(results);

        // Make editor read-only after submission
        if (inputEditor) {
            inputEditor.editor.updateOptions({ readOnly: true });
        }
    }
}

// Warn user if they try to leave during exam (handled in tab switch detection section)

// ========================================
// INITIALIZATION
// ========================================

// Set up first question when page loads
document.addEventListener('DOMContentLoaded', async function () {
    // Initialize Monaco editors first
    initializeMonacoEditors();
    
    // Load questions from JSON file first
    await loadQuestionsFromJSON();
    
    // Update total questions count based on loaded questions
    if (codingQuestions.length > 0) {
        // Update the totalQuestions variable to match loaded questions
        const totalQuestionsElement = document.getElementById('notVisitedCount');
        if (totalQuestionsElement) {
            totalQuestionsElement.textContent = codingQuestions.length;
        }
    }
    
    // Mark first question as visited
    visitedQuestions.add(1);
    updateQuestionNavigation(1);
    updateStatusCounters();

    // Initialize language button styles (set C++ as default active)
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.style.backgroundColor = 'rgb(11, 107, 252)';
    });
    const defaultLangBtn = document.getElementById('btn-cpp');
    if (defaultLangBtn) {
        defaultLangBtn.style.backgroundColor = 'rgb(0, 73, 183)';
    }

    // Now correctly load and display the first question
    goToQuestion(1);
});





// Change programming language
function changeLanguage(lang) {
    if (!inputEditor) return;
    
    // If the current question is already submitted, keep code/output intact
    if (answeredQuestions && answeredQuestions.has(currentQuestion)) {
        const lockedLang = localStorage.getItem(`question_${currentQuestion}_language`) || lang;
        // Only adjust syntax highlighting to the locked language; do not overwrite code
        monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[lockedLang]);
        // Reflect locked language in buttons
        document.querySelectorAll('.lang-btn').forEach(btn => { btn.style.backgroundColor = 'rgb(11, 107, 252)'; });
        const lockedBtn = document.getElementById(`btn-${lockedLang}`);
        if (lockedBtn) lockedBtn.style.backgroundColor = 'rgb(0, 73, 183)';
        console.log(`Question ${currentQuestion} is submitted. Language locked to: ${lockedLang}`);
        return;
    }

    preferredLanguage = lang;
    
    // If exam has started, set this as the preferred language for all questions
    if (examStarted) {
        preferredLanguage = lang;
        console.log(`Preferred language set to: ${lang} for all questions`);
    }
    
    // Update Monaco editor language
    monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[lang]);
    
    // Update button styles
    document.querySelectorAll('.lang-btn').forEach(btn => {
        btn.style.backgroundColor = 'rgb(11, 107, 252)';
    });
    
    const activeBtn = document.getElementById(`btn-${lang}`);
    if (activeBtn) {
        activeBtn.style.backgroundColor = 'rgb(0, 73, 183)';
    }
    
    // Always replace with the default template for the selected language (for unsubmitted questions)
    const template = inputEditor.getDefaultCode(lang);
    inputEditor.setValue(template);
    // Persist the language choice and template per question immediately
    localStorage.setItem(`question_${currentQuestion}_language`, lang);
    localStorage.setItem(`question_${currentQuestion}_code`, template);
    
    console.log(`Language changed to: ${lang}`);
}

// Enhanced code execution with language-specific compilation
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
    // Persist the current code immediately so it restores on revisit even without submission
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

// Unified function to execute code for all languages
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
            preprocessor: code => code // No preprocessing needed for Python
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
            preprocessor: code => code // No preprocessing needed for JavaScript
        }
    };

    const config = languageConfig[language];
    if (!config) {
        terminal.println(`Unsupported language: ${language}`);
        return;
    }

    terminal.clear();
    terminal.println(`${config.action} ${config.name} code...\n`);

    // Check if code needs input
    let needsInput = false;
    let inputCount = 0;
    
    for (const pattern of config.inputPatterns) {
        const matches = code.match(pattern);
        if (matches) {
            needsInput = true;
            inputCount += matches.length;
        }
    }

    // For JavaScript, do not pre-collect input.
    // The overridden window.prompt/window.confirm will request input at runtime.
    if (language === 'javascript') {
        needsInput = false;
        inputCount = 0;
    }

    let stdin = "";
    if (needsInput) {
    terminal.println(`Program requires ${inputCount} input(s).`);
    
    // Handle multiple inputs
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

    // Create and show loading indicator
    const loadingElement = document.createElement('div');
    loadingElement.className = 'loading-indicator';
    loadingElement.textContent = 'Executing code...';
    document.body.appendChild(loadingElement);
    
    try {
        if (language === 'javascript') {
            // Execute JavaScript locally
            const originalLog = console.log;
            const originalError = console.error;
            const originalWarn = console.warn;

            // Redirect console output to terminal
            const toText = (args) => args.map(a => {
                if (typeof a === 'string') return a;
                try { return JSON.stringify(a); } catch { return String(a); }
            }).join(' ');
            console.log = (...args) => terminal.println("Output: " + toText(args));
            console.error = (...args) => terminal.println("Error: " + toText(args));
            console.warn = (...args) => terminal.println("Warning: " + toText(args));

            // Handle prompt input with proper input management
            const originalPrompt = window.prompt;
            const originalConfirm = window.confirm;
            
            // Create a queue for inputs
            let inputQueue = [];
            if (stdin.trim()) {
                inputQueue = stdin.trim().split('\n');
            }
            
            // Support both awaited and non-awaited prompt usage
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
                // Execute the code in a proper context
                const result = await new Function(`
                    return (async () => {
                        try {
                            ${code}
                        } catch (error) {
                            throw error;
                        }
                    })();
                `)();
                
                // If the function returns a value, display it
                if (result !== undefined) {
                    terminal.println("Return value: " + result);
                }
            } catch (err) {
                terminal.println(`Runtime Error: ${err.message}`);
                if (err.stack) {
                    terminal.println(`Stack trace: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
                }
            } finally {
                // Restore original console functions
                console.log = originalLog;
                console.error = originalError;
                console.warn = originalWarn;
                window.prompt = originalPrompt;
                window.confirm = originalConfirm;
                // Persist output for the current question (JS branch)
                saveOutput();
            }
        } else {
            const processedCode = typeof config.preprocessor === 'function' ? config.preprocessor(code) : code;
            const result = await executeJudge0(config.id, processedCode, stdin);
            
            // Clear previous output
            terminal.clear();
            terminal.println(`Execution Results:`);
            terminal.println("=================================");

            if (result.error) {
                terminal.println(`API Error: ${result.error}`);
                return;
            }

            // Structure output based on status
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
            
            // Save output for current question
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

// Save current code to browser storage
function saveCode() {
    if (inputEditor) {
        const code = inputEditor.getValue();
        localStorage.setItem(`question_${currentQuestion}_code`, code);
        // Persist the active language at the time of saving
        localStorage.setItem(`question_${currentQuestion}_language`, preferredLanguage);
        console.log(`Auto-saved code for question ${currentQuestion}`);
    }
}

// Save output for current question
function saveOutput() {
    if (terminal && terminal.getOutput) {
        const output = terminal.getOutput();
        localStorage.setItem(`question_${currentQuestion}_output`, output);
        console.log(`Auto-saved output for question ${currentQuestion}`);
    }
}

// Load output for a specific question
function loadOutput(questionId) {
    const savedOutput = localStorage.getItem(`question_${questionId}_output`);
    if (terminal) {
        if (savedOutput && savedOutput.trim()) {
            terminal.setOutput(savedOutput);
        } else {
            // Load default placeholder
            terminal.clear();
            terminal.println('Click "Run Code" to execute your program...');
        }
    }
}

// Load code for a specific question
function loadCode(questionId) {
    const savedCode = localStorage.getItem(`question_${questionId}_code`);
    const savedLang = localStorage.getItem(`question_${questionId}_language`);
    if (inputEditor) {
        // Restore language first for proper syntax highlighting
        const langToUse = savedLang || preferredLanguage;
        monaco.editor.setModelLanguage(inputEditor.editor.getModel(), languageMap[langToUse]);

        if (savedCode && savedCode !== '// WRITE YOUR CODE HERE') {
            inputEditor.setValue(savedCode);
        } else {
            inputEditor.setValue(inputEditor.getDefaultCode(langToUse));
        }
    }

    // Also load the saved output
    loadOutput(questionId);
}



// ===============================
// FULLSCREEN FUNCTIONALITY
// ===============================
function openFullscreen() {
    const elem = document.documentElement;
    
    // Try different fullscreen methods for browser compatibility
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

// Show modal and require user gesture to enter fullscreen

    document.addEventListener('DOMContentLoaded', function () {
        const modal = document.getElementById('fullscreen-modal');
        const btn = document.getElementById('start-fullscreen-btn');
        
        if (btn) {
            btn.addEventListener('click', function () {
                openFullscreen();
                if (modal) modal.style.display = 'none';
                // Start the exam when user clicks start button
                startExam();
                // Automatically show question 1 when exam starts
                goToQuestion(1);
            });
        }
    });

// CSS handles layout in and out of fullscreen; no JS resizing needed
// ========================================
// SECURITY MEASURES
// ========================================

// Prevent screenshots, developer tools, and right-click
document.addEventListener("keydown", function (e) {
    // Detect PrintScreen
    if (e.key === "PrintScreen") {
        alert("Screenshot is disabled!");
        navigator.clipboard.writeText(" "); // Clears copied screenshot
    }

    // Block common dev tools shortcuts
    if (
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") || // Ctrl+Shift+I
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") || // Ctrl+Shift+J
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") || // Ctrl+Shift+C
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "p") || // Ctrl+Shift+P
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

// Block right-click
document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    alert("Right-click is disabled!");
});

// ===============================
// TAB SWITCH DETECTION
// ===============================
let lastFocusTime = Date.now();
let focusCheckInterval;

// Primary tab switch detection using visibilitychange
document.addEventListener("visibilitychange", () => {
    console.log("Visibility changed - hidden:", document.hidden, "state:", document.visibilityState, "examStarted:", examStarted, "tabSwitchDetected:", tabSwitchDetected);

    // Immediate detection when tab becomes hidden
    if (document.hidden && examStarted && !tabSwitchDetected) {
        console.log("Tab switch detected - terminating exam");
        tabSwitchDetected = true;
        alert("Tab switch detected. Your session will be terminated.");
        finishExam(true); // Skip confirmation dialog
        return;
    }

    // Additional check for when visibility state changes to 'hidden'
    if (document.visibilityState === 'hidden' && examStarted && !tabSwitchDetected) {
        console.log("Visibility state hidden detected - terminating exam");
        tabSwitchDetected = true;
        alert("Tab switch detected. Your session will be terminated.");
        finishExam(true);
    }
});

// Additional tab switch detection using pagehide event
window.addEventListener("pagehide", (event) => {
    if (examStarted && !tabSwitchDetected) {
        console.log("Page hide detected - terminating exam");
        tabSwitchDetected = true;
        finishExam(true);
    }
});

// Prevent tab switching using beforeunload
window.addEventListener("beforeunload", function (e) {
    if (examStarted) {
        saveCode(); // Save before leaving
        e.preventDefault();
        e.returnValue = 'Your exam is still in progress. Are you sure you want to leave?';
        return 'Your exam is still in progress. Are you sure you want to leave?';
    }
});

// Enhanced detection for window blur and focus
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

// Monitor focus changes more aggressively
function startFocusMonitoring() {
    if (focusCheckInterval) {
        clearInterval(focusCheckInterval);
    }

    focusCheckInterval = setInterval(() => {
        if (examStarted && !tabSwitchDetected) {
            const currentTime = Date.now();
            const timeSinceLastFocus = currentTime - lastFocusTime;

            // If more than 2 seconds have passed since last focus, consider it a tab switch
            if (timeSinceLastFocus > 2000 && !document.hasFocus()) {
                console.log("Focus monitoring detected tab switch - terminating exam");
                tabSwitchDetected = true;
                clearInterval(focusCheckInterval);
                alert("Tab switch detected. Your session will be terminated.");
                finishExam(true);
            }
        }
    }, 500); // Check every 500ms
}

function stopFocusMonitoring() {
    if (focusCheckInterval) {
        clearInterval(focusCheckInterval);
        focusCheckInterval = null;
    }
}

// Additional detection using document focus events
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

// Mouse leave detection (when mouse leaves the window)
document.addEventListener("mouseleave", () => {
    if (examStarted && !tabSwitchDetected) {
        console.log("Mouse leave detected - starting monitoring");
        startFocusMonitoring();
    }
});

// Reset tab switch detection when exam starts
function resetTabSwitchDetection() {
    tabSwitchDetected = false;
    lastFocusTime = Date.now();
    stopFocusMonitoring();
    startActivityMonitoring();
}

// Monitor user activity to detect tab switches
let lastActivityTime = Date.now();
let activityCheckInterval;

function startActivityMonitoring() {
    if (activityCheckInterval) {
        clearInterval(activityCheckInterval);
    }

    // Reset activity time
    lastActivityTime = Date.now();

    // Monitor for user activity
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'click', 'touchstart'];
    activityEvents.forEach(eventType => {
        document.addEventListener(eventType, () => {
            if (examStarted) {
                lastActivityTime = Date.now();
            }
        }, { passive: true });
    });

    // Check for inactivity and document state every second
    activityCheckInterval = setInterval(() => {
        if (examStarted && !tabSwitchDetected) {
            const currentTime = Date.now();
            const timeSinceLastActivity = currentTime - lastActivityTime;

            // Check if document is hidden or not focused
            if (document.hidden || !document.hasFocus()) {
                console.log("Periodic check detected tab switch - hidden:", document.hidden, "focused:", document.hasFocus());
                tabSwitchDetected = true;
                clearInterval(activityCheckInterval);
                alert("Tab switch detected. Your session will be terminated.");
                finishExam(true);
                return;
            }

            // If no activity for more than 3 seconds and page is not focused, consider it a tab switch
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