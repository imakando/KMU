import { auth, db } from './firebase-config.js';
import {
    collection,
    doc,
    getDocs,
    setDoc,
    updateDoc,
    query,
    where,
    onSnapshot,
    orderBy,
    serverTimestamp,
    addDoc,
    getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

let currentUser = null;
let stationsCache = [];
let chatsCache = [];
let activitiesCache = [];
let lastActivityCount = 0;
let lastChatCount = 0;

// Chart instances
let dailyAssignmentsChart = null;
let peakHoursChart = null;

// --- UTILITY FUNCTIONS ---
function showScreen(screenId) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'none';
    document.getElementById('supervisor-dashboard').style.display = 'none';
    document.getElementById(screenId).style.display = 'block';
}

function toast(message, isError = false) {
    const toastEl = document.getElementById('toast');
    if (toastEl) {
        toastEl.textContent = message;
        toastEl.style.display = 'block';
        toastEl.style.borderColor = isError ? '#ff3333' : '#0f9d58';
        setTimeout(() => {
            toastEl.style.display = 'none';
        }, 3000);
    }
}

async function logAudit(action, details = '') {
    if (currentUser) {
        try {
            await addDoc(collection(db, 'activities'), {
                user_id: currentUser.id,
                role: currentUser.role,
                action: action,
                details: details,
                timestamp: serverTimestamp()
            });
        } catch (error) {
            console.error("Error logging audit:", error);
        }
    }
}

function handleNotifications() {
    const adminChatNotification = document.getElementById('admin-chat-notification');
    const supervisorChatNotification = document.getElementById('supervisor-chat-notification');

    if (!adminChatNotification || !supervisorChatNotification) return;

    if (currentUser.role === 'admin') {
        // Admin notification for new supervisor messages
        const newChats = chatsCache.filter(chat => chat.sender === 'supervisor').length;
        if (newChats > lastChatCount) {
            toast('New message from a supervisor!');
            adminChatNotification.style.display = 'inline';
        } else {
            adminChatNotification.style.display = 'none';
        }
        lastChatCount = newChats;
    } else if (currentUser.role === 'supervisor') {
        // Supervisor notification for new admin messages
        const newChats = chatsCache.filter(chat => chat.sender === 'admin').length;
        if (newChats > lastChatCount) {
            toast('New message from the Admin!');
            supervisorChatNotification.style.display = 'inline';
        } else {
            supervisorChatNotification.style.display = 'none';
        }
        lastChatCount = newChats;
    }

    // New station assignment notification for admin
    const newAssignments = activitiesCache.filter(a => a.action === 'station_assign').length;
    if (currentUser.role === 'admin' && newAssignments > lastActivityCount) {
        toast('A new station has been assigned!');
    }
    lastActivityCount = newAssignments;
}

// --- CHARTING FUNCTIONS ---
function renderCharts() {
    const dailyCanvas = document.getElementById('daily-assignments-chart');
    const peakCanvas = document.getElementById('peak-hours-chart');
    if (!dailyCanvas || !peakCanvas) return;

    const stationAssignActivities = activitiesCache.filter(a => a.action === 'station_assign' && a.timestamp);

    // Data for Daily Assignments Chart
    const dailyData = stationAssignActivities.reduce((acc, activity) => {
        const date = activity.timestamp.toDate().toLocaleDateString();
        acc[date] = (acc[date] || 0) + 1;
        return acc;
    }, {});
    const dailyLabels = Object.keys(dailyData).sort();
    const dailyValues = dailyLabels.map(label => dailyData[label]);

    // Data for Peak Usage Hours Chart
    const hourlyData = stationAssignActivities.reduce((acc, activity) => {
        const hour = activity.timestamp.toDate().getHours();
        acc[hour] = (acc[hour] || 0) + 1;
        return acc;
    }, {});
    const hourlyLabels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    const hourlyValues = hourlyLabels.map((_, i) => hourlyData[i] || 0);

    // Render Daily Assignments Chart
    if (dailyAssignmentsChart) {
        dailyAssignmentsChart.destroy();
    }
    dailyAssignmentsChart = new Chart(dailyCanvas, {
        type: 'bar',
        data: {
            labels: dailyLabels,
            datasets: [{
                label: 'Total Assignments',
                data: dailyValues,
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });

    // Render Peak Hours Chart
    if (peakHoursChart) {
        peakHoursChart.destroy();
    }
    peakHoursChart = new Chart(peakCanvas, {
        type: 'line',
        data: {
            labels: hourlyLabels,
            datasets: [{
                label: 'Assignments per Hour',
                data: hourlyValues,
                backgroundColor: 'rgba(153, 102, 255, 0.2)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 1,
                fill: true
            }]
        },
        options: {
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Ensure the DOM is fully loaded before attaching any event listeners
document.addEventListener('DOMContentLoaded', () => {

    function setupNavigation() {
        const navButtons = document.querySelectorAll('[data-target]');
        navButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetId = button.getAttribute('data-target');
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });

        const backToTopButtons = document.querySelectorAll('.back-to-top-btn');
        backToTopButtons.forEach(button => {
            button.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });
    }

    setupNavigation();


    // --- UI TOGGLING ---
    const showAdminLoginBtn = document.getElementById('show-admin-login-btn');
    const showSupervisorLoginBtn = document.getElementById('show-supervisor-login-btn');
    const adminLoginForm = document.getElementById('admin-login-form');
    const supervisorLoginForm = document.getElementById('supervisor-login-form');

    if (showAdminLoginBtn && showSupervisorLoginBtn && adminLoginForm && supervisorLoginForm) {
        showAdminLoginBtn.addEventListener('click', () => {
            adminLoginForm.style.display = 'block';
            supervisorLoginForm.style.display = 'none';
        });

        showSupervisorLoginBtn.addEventListener('click', () => {
            supervisorLoginForm.style.display = 'block';
            adminLoginForm.style.display = 'none';
        });
    }

    // --- AUTHENTICATION & UI ---
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('admin-login-email').value;
        const password = document.getElementById('admin-login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
            logAudit('login', 'Admin logged in successfully');
        } catch (error) {
            toast('Login failed: Invalid credentials.', true);
            console.error('Login error:', error);
        }
    });

    document.getElementById('supervisor-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('supervisor-login-email').value;
        const password = document.getElementById('supervisor-login-password').value;
        try {
            await signInWithEmailAndPassword(auth, email, password);
            logAudit('login', 'Supervisor logged in successfully');
        } catch (error) {
            toast('Login failed: Invalid credentials.', true);
            console.error('Login error:', error);
        }
    });

    document.querySelectorAll('.logout-btn').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                await signOut(auth);
                logAudit('logout', 'User logged out');
                toast('Logged out successfully.');
            } catch (error) {
                console.error('Logout error:', error);
            }
        });
    });

    onAuthStateChanged(auth, async (user) => {
        const healthStatus = document.getElementById('health-status');
        if (user) {
            healthStatus.textContent = 'ONLINE';
            healthStatus.style.color = '#00ff00';

            const adminQuery = query(collection(db, 'admins'), where('email', '==', user.email.toLowerCase()));
            const adminDocs = await getDocs(adminQuery);

            if (!adminDocs.empty) {
                currentUser = { ...adminDocs.docs[0].data(), id: adminDocs.docs[0].id, role: 'admin' };
                showScreen('admin-dashboard');
                return;
            }

            const supervisorQuery = query(collection(db, 'supervisors'), where('email', '==', user.email.toLowerCase()));
            const supervisorDocs = await getDocs(supervisorQuery);

            if (!supervisorDocs.empty) {
                currentUser = { ...supervisorDocs.docs[0].data(), id: supervisorDocs.docs[0].id, role: 'supervisor' };
                showScreen('supervisor-dashboard');
                return;
            }

            await signOut(auth);
            toast('User not authorized. Please check your credentials.', true);
        } else {
            healthStatus.textContent = 'OFFLINE';
            healthStatus.style.color = '#ff3333';
            currentUser = null;
            showScreen('login-screen');
        }
    });

    // --- ADMIN DASHBOARD FUNCTIONS ---
    const adminChatForm = document.getElementById('admin-chat-form');
    if (adminChatForm) {
        adminChatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const messageInput = document.getElementById('admin-chat-input');
            const message = messageInput.value;
            await addDoc(collection(db, 'chats'), {
                sender: 'admin',
                message: message,
                time: serverTimestamp()
            });
            messageInput.value = '';
            logAudit('chat_message_sent', 'Sent a message to supervisor');
        });
    }

    const downloadPdfBtn = document.getElementById('download-report-pdf-btn');
    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', () => {
            toast('PDF report download is not yet implemented.');
            logAudit('report_download', 'Attempted to download PDF report');
        });
    }

    const downloadDocxBtn = document.getElementById('download-report-docx-btn');
    if (downloadDocxBtn) {
        downloadDocxBtn.addEventListener('click', () => {
            toast('Word report download is not yet implemented.');
            logAudit('report_download', 'Attempted to download Word report');
        });
    }

    // --- SUPERVISOR DASHBOARD FUNCTIONS ---
    const studentLookupForm = document.getElementById('student-lookup-form');
    if (studentLookupForm) {
        studentLookupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const studentId = document.getElementById('student-lookup-id').value;
            const studentDetailsCard = document.getElementById('student-details-card');
            const studentDoc = await getDoc(doc(db, 'students', studentId));
            
            if (studentDoc.exists()) {
                const studentData = studentDoc.data();
                document.getElementById('fetched-student-name').textContent = studentData.name;
                document.getElementById('fetched-student-id').textContent = studentId;
                document.getElementById('fetched-student-program').textContent = studentData.program;
                document.getElementById('fetched-student-hostel').textContent = studentData.hostel;
                document.getElementById('fetched-student-year').textContent = studentData.year;
                studentDetailsCard.style.display = 'block';
                logAudit('student_lookup', `Looked up student ID: ${studentId}`);
            } else {
                studentDetailsCard.style.display = 'none';
                toast('Student not found!', true);
            }
        });
    }

    const assignAndGenerateKeyBtn = document.getElementById('assign-and-generate-key-btn');
    if (assignAndGenerateKeyBtn) {
        assignAndGenerateKeyBtn.addEventListener('click', async () => {
            const studentId = document.getElementById('fetched-student-id').textContent;
            const stationSelect = document.getElementById('station-select');
            const selectedStationId = stationSelect.value;
            
            if (!studentId || !selectedStationId) {
                toast('Please fetch student details and select a station.', true);
                return;
            }

            const station = stationsCache.find(s => s.id === selectedStationId);
            if (station && station.is_occupied) {
                toast('This station is already occupied.', true);
                return;
            }

            const sessionKey = Math.random().toString(36).substring(2, 8).toUpperCase();
            try {
                await updateDoc(doc(db, 'stations', selectedStationId), {
                    is_occupied: true,
                    occupied_by: studentId,
                    key: sessionKey
                });
                
                document.getElementById('generated-key').textContent = sessionKey;
                document.getElementById('generated-key-display').style.display = 'block';
                toast(`Session key generated for student ${studentId}.`);
                logAudit('station_assign', `Assigned station ${station.name} to student ${studentId} with key ${sessionKey}`);
            } catch (error) {
                console.error('Error assigning station:', error);
                toast('Error assigning station.', true);
            }
        });
    }

    const supervisorChatForm = document.getElementById('supervisor-chat-form');
    if (supervisorChatForm) {
        supervisorChatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const messageInput = document.getElementById('supervisor-chat-input');
            const message = messageInput.value;
            await addDoc(collection(db, 'chats'), {
                sender: 'supervisor',
                message: message,
                time: serverTimestamp()
            });
            messageInput.value = '';
            logAudit('chat_message_sent', 'Sent a message to admin');
        });
    }

    // --- DATA LISTENERS ---
    onSnapshot(collection(db, 'stations'), snapshot => {
        stationsCache = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        renderStations();
        const stationSelect = document.getElementById('station-select');
        if (stationSelect) {
            stationSelect.innerHTML = '<option value="">Select a Station</option>';
            stationsCache.forEach(station => {
                const option = document.createElement('option');
                option.value = station.id;
                option.textContent = station.name + (station.is_occupied ? ' (Occupied)' : ' (Available)');
                option.disabled = station.is_occupied;
                stationSelect.appendChild(option);
            });
        }
    });

    onSnapshot(query(collection(db, 'chats'), orderBy('time')), q => {
        const previousChatCount = chatsCache.length;
        chatsCache = q.docs.map(doc => ({ ...doc.data(), docId: doc.id }));
        renderChats();
        if (chatsCache.length > previousChatCount) {
             handleNotifications();
        }
    });

    onSnapshot(query(collection(db, 'activities'), orderBy('timestamp', 'desc')), q => {
        const previousActivityCount = activitiesCache.length;
        activitiesCache = q.docs.map(doc => ({ ...doc.data(), docId: doc.id }));
        renderAuditTrail();
        renderCharts();
        if (activitiesCache.length > previousActivityCount) {
            handleNotifications();
        }
    });
});

// --- RENDER FUNCTIONS ---
function renderStations() {
    const adminStationsContainer = document.getElementById('stations-grid');
    if (!adminStationsContainer) return;

    adminStationsContainer.innerHTML = '';
    stationsCache.forEach(station => {
        const card = document.createElement('div');
        card.classList.add('station-card', station.is_occupied ? 'occupied' : 'unoccupied');
        card.innerHTML = `
            <p class="text-xl font-bold">${station.name}</p>
            <p>${station.is_occupied ? 'Occupied' : 'Unoccupied'}</p>
            <p>${station.is_occupied ? `by: ${station.occupied_by}` : ''}</p>
        `;
        adminStationsContainer.appendChild(card);
    });
}

function renderChats() {
    const adminChatBox = document.getElementById('admin-chat-box');
    const supervisorChatBox = document.getElementById('supervisor-chat-box');

    const chatBoxToRender = adminChatBox || supervisorChatBox;

    if (!chatBoxToRender) return;

    chatBoxToRender.innerHTML = '';
    chatsCache.forEach(chat => {
        const p = document.createElement('p');
        p.classList.add('chat-message', chat.sender === 'admin' ? 'admin' : 'supervisor');
        p.textContent = `${chat.sender}: ${chat.message}`;
        chatBoxToRender.appendChild(p);
    });
    chatBoxToRender.scrollTop = chatBoxToRender.scrollHeight;
}

function renderAuditTrail() {
    const auditBody = document.getElementById('audit-body');
    if (!auditBody) return;
    
    auditBody.innerHTML = '';
    activitiesCache.forEach(activity => {
        const row = document.createElement('tr');
        const timestamp = activity.timestamp?.toDate().toLocaleString() || 'N/A';
        row.innerHTML = `
            <td>${timestamp}</td>
            <td>${activity.user_id}</td>
            <td>${activity.role}</td>
            <td>${activity.action}</td>
        `;
        auditBody.appendChild(row);
    });
}