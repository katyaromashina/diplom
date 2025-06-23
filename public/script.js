let qrInterval = null;
let scanning = false;
        let isVerifyingFace = false;
        let authToken = null;
        let capturedPhoto = null; // Хранит сделанное фото
        const qrCodeDiv = document.getElementById('qrCode');
        const subjectInput = document.getElementById('subject');
        const startBtn = document.getElementById('startBtn');
        const viewJournalBtn = document.getElementById('viewJournalBtn');
        const exportJournalBtn = document.getElementById('exportJournalBtn');
        const lectureSelect = document.getElementById('lectureSelect');
        const fullNameInput = document.getElementById('fullName');
        const groupInput = document.getElementById('group');
        const scanBtn = document.getElementById('scanBtn');
        const stopScanBtn = document.getElementById('stopScanBtn');
        const statusP = document.getElementById('status');
        const faceStatusP = document.getElementById('faceStatus');
        const loginSection = document.getElementById('loginSection');
        const teacherSection = document.getElementById('teacherSection');
        const studentSection = document.getElementById('studentSection');
        const teacherBtn = document.getElementById('teacherBtn');
        const studentBtn = document.getElementById('studentBtn');
        const loginBtn = document.getElementById('loginBtn');
        const usernameInput = document.getElementById('username');
        const passwordInput = document.getElementById('password');
        const loginStatusP = document.getElementById('loginStatus');
        const videoContainer = document.getElementById('videoContainer');
        const video = document.getElementById('video');
        const canvas = document.getElementById('canvas');
        const qrOverlay = document.getElementById('qrOverlay');
        const journalSection = document.getElementById('journalSection');
        const journalBody = document.getElementById('journalBody');
        const capturePhotoBtn = document.getElementById('capturePhotoBtn');
        const photoPreviewContainer = document.getElementById('photoPreviewContainer');
        const photoPreview = document.getElementById('photoPreview');
        const retakePhotoBtn = document.getElementById('retakePhotoBtn');
        const submitPhotoBtn = document.getElementById('submitPhotoBtn');
        let stream = null;

        const serverHost = window.location.hostname;
        const serverUrl = `${window.location.protocol}//${serverHost}${window.location.port ? ':' + window.location.port : ''}`;

        async function loadFaceApiModels() { //ЗАГРУЗКА МОДЕЛЕЙ ДЛЯ ЛИЦ
            try {
                console.log('Загрузка моделей face-api.js...');
                statusP.textContent = 'Загрузка моделей face-api.js...';
                await Promise.all([
                    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
                    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
                    faceapi.nets.faceRecognitionNet.loadFromUri('/models')
                ]);
                console.log('Модели face-api.js загружены');
                statusP.textContent = 'Модели face-api.js загружены';
            } catch (err) {
                console.error('Ошибка загрузки моделей face-api.js:', err);
                faceStatusP.textContent = 'Ошибка загрузки моделей распознавания лиц';
                faceStatusP.classList.add('text-red-500');
            }
        }

        loadFaceApiModels();

        teacherBtn.addEventListener('click', () => { //КНОПКА ПЕРЕХОДА В РЕЖИМ ПРЕПОДА
            if (authToken) {
                loginSection.classList.add('hidden');
                teacherSection.classList.remove('hidden');
                studentSection.classList.add('hidden');
                loadLectures();
            } else {
                loginSection.classList.remove('hidden');
                teacherSection.classList.add('hidden');
                studentSection.classList.add('hidden');
            }
            stopCamera();
        });

        studentBtn.addEventListener('click', () => { //КНОПКА РЕЖИМ СТУДЕНТА
            studentSection.classList.remove('hidden');
            teacherSection.classList.add('hidden');
            loginSection.classList.add('hidden');
            stopCamera();
        });

        loginBtn.addEventListener('click', async () => {
            const username = usernameInput.value.trim();
            const password = passwordInput.value.trim();
            if (!username || !password) {
                loginStatusP.textContent = 'Введите имя пользователя и пароль';
                loginStatusP.classList.add('text-red-500');
                return;
            }

            try {
                const response = await fetch(`${serverUrl}/login`, {
                    method: 'POST',
                    body: JSON.stringify({ username, password }),
                    headers: { 'Content-Type': 'application/json' },
                });
                const result = await response.json();
                if (result.success) {
                    authToken = result.token;
                    localStorage.setItem('authToken', authToken); // Сохраняем токен
                    if (result.isAdmin) {
                        window.location.href = '/admin';
                    } else {
                        loginSection.classList.add('hidden');
                        teacherSection.classList.remove('hidden');
                        loginStatusP.textContent = 'Вход успешен!';
                        loginStatusP.classList.remove('text-red-500');
                        loginStatusP.classList.add('text-green-500');
                        loadLectures();
                    }
                } else {
                    loginStatusP.textContent = result.error || 'Ошибка входа';
                    loginStatusP.classList.add('text-red-500');
                }
            } catch (err) {
                console.error('Ошибка входа:', err);
                loginStatusP.textContent = 'Ошибка сервера: ' + err.message;
                loginStatusP.classList.add('text-red-500');
            }
        });

        function generateUniqueCode() {
            return Math.random().toString(36).substr(2, 9) + '-' + Date.now();
        }

        function generateLectureId(subject) {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            return `${subject.replace(/\s+/g, '_')}_${hours}:${minutes}`;
        }

        startBtn.addEventListener('click', () => {
            if (!authToken) {
                alert('Требуется авторизация');
                loginSection.classList.remove('hidden');
                teacherSection.classList.add('hidden');
                return;
            }

            const subject = subjectInput.value.trim();
            if (!subject) {
                alert('Введите название предмета');
                return;
            }

            const lectureId = generateLectureId(subject);
            if (qrInterval) clearInterval(qrInterval);
            qrCodeDiv.innerHTML = '';
            generateQRCode(subject, lectureId);

            qrInterval = setInterval(() => {
                qrCodeDiv.innerHTML = '';
                generateQRCode(subject, lectureId);
            }, 2000); // Синхронизировано с сервером
        });

        function generateQRCode(subject, lectureId) {
            const uniqueCode = generateUniqueCode();
            const qrText = uniqueCode;

            new QRCode(qrCodeDiv, {
                text: qrText,
                width: 300,
                height: 300,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });

            fetch(`${serverUrl}/storeCode`, {
                method: 'POST',
                body: JSON.stringify({ subject, code: uniqueCode, timestamp: Date.now(), lectureId }),
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': authToken
                }
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => console.log('Ответ от /storeCode:', data))
                .catch(error => {
                    console.error('Ошибка при отправке QR-кода:', error);
                    alert('Ошибка авторизации или сервера. Пожалуйста, войдите снова.');
                    authToken = null;
                    loginSection.classList.remove('hidden');
                    teacherSection.classList.add('hidden');
                });
        }

        async function loadLectures() {
            if (!authToken) return;
            try {
                const response = await fetch(`${serverUrl}/lectures`, {
                    headers: { 'Authorization': authToken }
                });
                const result = await response.json();
                if (result.success) {
                    lectureSelect.innerHTML = '<option value="">Все лекции</option>';
                    result.lectures.forEach(lecture => {
                        const option = document.createElement('option');
                        option.value = lecture.lecture_id;
                        option.textContent = lecture.lecture_id;
                        lectureSelect.appendChild(option);
                    });
                } else {
                    alert(result.error || 'Ошибка получения списка лекций');
                }
            } catch (err) {
                console.error('Ошибка получения списка лекций:', err);
                alert('Ошибка сервера. Пожалуйста, войдите снова.');
                authToken = null;
                loginSection.classList.remove('hidden');
                teacherSection.classList.add('hidden');
            }
        }

        viewJournalBtn.addEventListener('click', async () => {
            if (!authToken) {
                alert('Требуется авторизация');
                loginSection.classList.remove('hidden');
                teacherSection.classList.add('hidden');
                return;
            }

            try {
                const lectureId = lectureSelect.value;
                const url = lectureId ? `${serverUrl}/journal?lectureId=${encodeURIComponent(lectureId)}` : `${serverUrl}/journal`;
                const response = await fetch(url, {
                    headers: { 'Authorization': authToken }
                });
                const result = await response.json();
                if (result.success) {
                    journalSection.classList.remove('hidden');
                    journalBody.innerHTML = '';
                    result.records.forEach(record => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${record.subject}</td>
                            <td>${record.full_name}</td>
                            <td>${record.group_name}</td>
                            <td>${new Date(record.attendance_time).toLocaleString()}</td>
                        `;
                        journalBody.appendChild(row);
                    });
                } else {
                    alert(result.error || 'Ошибка получения журнала');
                }
            } catch (err) {
                console.error('Ошибка получения журнала:', err);
                alert('Ошибка сервера. Пожалуйста, войдите снова.');
                authToken = null;
                loginSection.classList.remove('hidden');
                teacherSection.classList.add('hidden');
            }
        });

        exportJournalBtn.addEventListener('click', async () => {
            if (!authToken) {
                alert('Требуется авторизация');
                loginSection.classList.remove('hidden');
                teacherSection.classList.add('hidden');
                return;
            }

            try {
                const lectureId = lectureSelect.value;
                const url = lectureId ? `${serverUrl}/export-journal?lectureId=${encodeURIComponent(lectureId)}` : `${serverUrl}/export-journal`;
                console.log('Запрос экспорта:', url);
                const response = await fetch(url, {
                    headers: { 'Authorization': authToken }
                });
                if (!response.ok) {
                    if (response.status === 401 || response.status === 403) {
                        throw new Error('Ошибка авторизации');
                    }
                    const errorData = await response.json();
                    throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorData.error || 'Неизвестная ошибка'}`);
                }
                const blob = await response.blob();
                const downloadUrl = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = lectureId ? `attendance_${lectureId.replace(/\s+/g, '_')}.xlsx` : 'attendance_all.xlsx';
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(downloadUrl);
            } catch (err) {
                console.error('Ошибка экспорта журнала:', err);
                if (err.message.includes('Ошибка авторизации')) {
                    alert('Ошибка авторизации. Пожалуйста, войдите снова.');
                    authToken = null;
                    loginSection.classList.remove('hidden');
                    teacherSection.classList.add('hidden');
                } else {
                    alert(`Ошибка экспорта: ${err.message}`);
                }
            }
        });

        scanBtn.addEventListener('click', async () => {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                statusP.textContent = 'Браузер не поддерживает камеру';
                statusP.classList.add('text-red-500');
                return;
            }

            if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
                statusP.textContent = 'Требуется HTTPS. Используйте ngrok';
                statusP.classList.add('text-red-500');
                return;
            }

            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { 
                        facingMode: 'environment', 
                        width: { ideal: 640, max: 1280 }, 
                        height: { ideal: 480, max: 720 } 
                    }
                });
                video.srcObject = stream;
                videoContainer.classList.remove('hidden');
                stopScanBtn.classList.remove('hidden');
                scanBtn.classList.add('hidden');
                scanning = true;

                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        console.log(`Видео начато: ${video.videoWidth}x${video.videoHeight}`);
                        scanQRCode();
                    }).catch(err => {
                        console.error('Ошибка воспроизведения:', err);
                        statusP.textContent = 'Ошибка видео: ' + err.message;
                        statusP.classList.add('text-red-500');
                        stopCamera();
                    });
                };
            } catch (err) {
                console.error('Ошибка камеры:', err);
                statusP.textContent = 'Ошибка камеры: ' + err.message;
                statusP.classList.add('text-red-500');
                scanBtn.classList.remove('hidden');
            }
        });

        function stopCamera(preserveStatus = false) {
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
                stream = null;
                videoContainer.classList.add('hidden');
                stopScanBtn.classList.add('hidden');
                scanBtn.classList.remove('hidden');
                capturePhotoBtn.classList.add('hidden');
                photoPreviewContainer.classList.add('hidden');
                scanning = false;
                qrOverlay.getContext('2d').clearRect(0, 0, qrOverlay.width, qrOverlay.height);
                faceStatusP.textContent = '';
                if (!preserveStatus) {
                    statusP.textContent = '';
                }
                console.log('Камера остановлена');
            }
        }

        stopScanBtn.addEventListener('click', stopCamera);

        async function checkQRCode(qrCode) {
            const fullName = fullNameInput.value.trim();
            const group = groupInput.value.trim();

            if (!fullName || !group) {
                statusP.textContent = 'Заполните поля ФИО и Группа перед сканированием QR-кода';
                statusP.classList.add('text-red-500');
                return null;
            }

            try {
                const response = await fetch(`${serverUrl}/checkAndSave`, {
                    method: 'POST',
                    body: JSON.stringify({ code: qrCode, fullName, group }),
                    headers: { 'Content-Type': 'application/json' }
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }

                const result = await response.json();
                console.log('Ответ от /checkAndSave:', result);
                console.log('Сформированный URL для фото:', `${serverUrl}${result.photoPath}`);
                if (result.success) {
                    statusP.textContent = 'QR-код подтверждён! Сделайте фото лица...';
                    statusP.classList.remove('text-red-500');
                    statusP.classList.add('text-green-500');
                    return result;
                } else {
                    statusP.textContent = result.error || 'QR-код не найден или устарел';
                    statusP.classList.add('text-red-500');
                    return null;
                }
            } catch (err) {
                console.error('Ошибка проверки QR-кода:', err);
                statusP.textContent = 'Ошибка сервера: ' + err.message;
                statusP.classList.add('text-red-500');
                return null;
            }
        }

        function scanQRCode() {
            if (!scanning) {
                console.log('Сканирование остановлено');
                return;
            }

            const context = canvas.getContext('2d');
            const overlayContext = qrOverlay.getContext('2d');

            function tick() {
                if (!scanning) {
                    console.log('Цикл tick остановлен');
                    return;
                }

                if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    qrOverlay.width = video.videoWidth;
                    qrOverlay.height = video.videoHeight;
                    console.log('Размеры холста:', { width: canvas.width, height: canvas.height });

                    try {
                        context.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                        console.log('Изображение захвачено');
                        const code = jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: 'attemptBoth'
                        });

                        overlayContext.clearRect(0, 0, qrOverlay.width, qrOverlay.height);
                        if (code && code.data && !isVerifyingFace) {
                            console.log('QR-код распознан:', code.data);
                            drawQRBoundingBox(overlayContext, code.location);
                            scanning = false;
                            checkQRCode(code.data).then(result => {
                                if (result) {
                                    verifyFace(code.data, result.subject, result.photoPath, result.lectureId);
                                } else {
                                    scanning = true;
                                    statusP.textContent = 'Наведите камеру на QR-код...';
                                    statusP.classList.remove('text-red-500', 'text-green-500');
                                    setTimeout(() => requestAnimationFrame(tick), 200);
                                }
                            });
                            return;
                        } else if (!code) {
                            console.log('QR-код не найден');
                            if (!isVerifyingFace) {
                                statusP.textContent = 'Наведите камеру на QR-код...';
                                statusP.classList.remove('text-red-500', 'text-green-500');
                            }
                        }
                    } catch (err) {
                        console.error('Ошибка сканирования:', err);
                        statusP.textContent = 'Ошибка сканирования: ' + err.message;
                        statusP.classList.add('text-red-500');
                        scanning = false;
                        stopCamera();
                        isVerifyingFace = false;
                    }
                } else {
                    console.log('Видео не готово:', {
                        readyState: video.readyState,
                        videoWidth: video.videoWidth,
                        videoHeight: video.videoHeight
                    });
                    statusP.textContent = 'Ожидание видеопотока...';
                    statusP.classList.remove('text-red-500', 'text-green-500');
                }

                setTimeout(() => requestAnimationFrame(tick), 200);
            }
            requestAnimationFrame(tick);
        }

        function drawQRBoundingBox(context, location) {
            if (!location) return;
            const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = location;
            context.strokeStyle = 'green';
            context.lineWidth = 4;
            context.beginPath();
            context.moveTo(topLeftCorner.x, topLeftCorner.y);
            context.lineTo(topRightCorner.x, topRightCorner.y);
            context.lineTo(bottomRightCorner.x, bottomRightCorner.y);
            context.lineTo(bottomLeftCorner.x, bottomLeftCorner.y);
            context.closePath();
            context.stroke();
        }

        async function verifyFace(qrCode, subject, photoPath, lectureId) {
            const fullName = fullNameInput.value.trim();
            const group = groupInput.value.trim();
            const code = qrCode.trim();
            let attemptCount = 1; // Счётчик попыток
            const maxAttempts = 3; // Максимум попыток

            if (!fullName || !group) {
                statusP.textContent = 'Заполните поля ФИО и Группа';
                statusP.classList.add('text-red-500');
                stopCamera();
                scanning = true;
                isVerifyingFace = false;
                return;
            }

            isVerifyingFace = true;

            try {
                stopCamera();
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { 
                        facingMode: 'user',
                        width: { ideal: 640, max: 1280 }, 
                        height: { ideal: 480, max: 720 } 
                    }
                });
                video.srcObject = stream;
                videoContainer.classList.remove('hidden');
                capturePhotoBtn.classList.remove('hidden');
                console.log('Фронтальная камера запущена');

                video.onloadedmetadata = () => {
                    video.play().then(() => {
                        console.log(`Видео с фронтальной камеры начато: ${video.videoWidth}x${video.videoHeight}`);
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;
                    }).catch(err => {
                        console.error('Ошибка воспроизведения фронтальной камеры:', err);
                        statusP.textContent = 'Ошибка видео: ' + err.message;
                        statusP.classList.add('text-red-500');
                        stopCamera();
                        scanning = true;
                        isVerifyingFace = false;
                    });
                };

                // Загрузка эталонного изображения
                const referenceImage = new Image();
                referenceImage.crossOrigin = 'Anonymous';
                referenceImage.src = `${serverUrl}/${photoPath}`;

                await new Promise((resolve, reject) => {
                    referenceImage.onload = () => {
                        console.log('Фото студента успешно загружено:', referenceImage.src);
                        resolve();
                    };
                    referenceImage.onerror = () => {
                        console.error('Не удалось загрузить фото:', referenceImage.src);
                        reject(new Error(`Не удалось загрузить фото студента: ${referenceImage.src}`));
                    };
                });

                const referenceDetections = await faceapi
                    .detectSingleFace(referenceImage, new faceapi.TinyFaceDetectorOptions())
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (!referenceDetections) {
                    faceStatusP.textContent = 'Лицо на эталонном фото не найдено';
                    faceStatusP.classList.add('text-red-500');
                    statusP.textContent = 'Ошибка: Проверка лица не удалась';
                    statusP.classList.add('text-red-500');
                    stopCamera();
                    scanning = true;
                    isVerifyingFace = false;
                    return;
                }

                // Обработчик кнопки "Сделать фото"
                capturePhotoBtn.onclick = () => {
                    const context = canvas.getContext('2d');
                    context.drawImage(video, 0, 0, canvas.width, canvas.height);
                    capturedPhoto = new Image();
                    capturedPhoto.src = canvas.toDataURL('image/jpeg');
                    videoContainer.classList.add('hidden');
                    capturePhotoBtn.classList.add('hidden');
                    photoPreviewContainer.classList.remove('hidden');
                    photoPreview.src = capturedPhoto.src;
                    faceStatusP.textContent = `Проверьте фото и отправьте или переснимите (попытка ${attemptCount}/${maxAttempts})`;
                    faceStatusP.classList.remove('text-red-500', 'text-green-500');
                };

                // Обработчик кнопки "Переснять"
                retakePhotoBtn.onclick = () => {
                    photoPreviewContainer.classList.add('hidden');
                    videoContainer.classList.remove('hidden');
                    capturePhotoBtn.classList.remove('hidden');
                    capturedPhoto = null;
                    faceStatusP.textContent = `Наведите камеру на лицо и сделайте фото (попытка ${attemptCount}/${maxAttempts})`;
                    faceStatusP.classList.remove('text-red-500', 'text-green-500');
                };

                // Обработчик кнопки "Отправить"
                submitPhotoBtn.onclick = async () => {
                    if (!capturedPhoto) {
                        faceStatusP.textContent = 'Сначала сделайте фото';
                        faceStatusP.classList.add('text-red-500');
                        return;
                    }

                    try {
                        const liveDetections = await faceapi
                            .detectSingleFace(capturedPhoto, new faceapi.TinyFaceDetectorOptions())
                            .withFaceLandmarks()
                            .withFaceDescriptor();

                        if (!liveDetections) {
                            attemptCount++;
                            if (attemptCount <= maxAttempts) {
                                faceStatusP.textContent = `Лицо на фото не найдено. Попробуйте снова (попытка ${attemptCount}/${maxAttempts})`;
                                faceStatusP.classList.add('text-red-500');
                                photoPreviewContainer.classList.add('hidden');
                                videoContainer.classList.remove('hidden');
                                capturePhotoBtn.classList.remove('hidden');
                                capturedPhoto = null;
                                return;
                            } else {
                                faceStatusP.textContent = 'Лицо не найдено после максимального количества попыток';
                                faceStatusP.classList.add('text-red-500');
                                statusP.textContent = 'Ошибка: Проверка лица не удалась. Обратитесь к преподователю';
                                statusP.classList.add('text-red-500');
                                stopCamera(true);
                                scanning = true;
                                isVerifyingFace = false;
                                return;
                            }
                        }

                        const distance = faceapi.euclideanDistance(
                            referenceDetections.descriptor,
                            liveDetections.descriptor
                        );
                        console.log('Расстояние между лицами:', distance);

                        if (distance < 0.6) {
                            faceStatusP.textContent = 'Лицо подтверждено!';
                            faceStatusP.classList.add('text-green-500');
                            statusP.textContent = 'Отправка данных...';
                            statusP.classList.remove('text-red-500');
                            statusP.classList.add('text-green-500');
                            submitAttendance(code, fullName, group, subject, lectureId);
                        } else {
                            attemptCount++;
                            if (attemptCount <= maxAttempts) {
                                faceStatusP.textContent = `Лицо не совпадает. Попробуйте снова (попытка ${attemptCount}/${maxAttempts})`;
                                faceStatusP.classList.add('text-red-500');
                                photoPreviewContainer.classList.add('hidden');
                                videoContainer.classList.remove('hidden');
                                capturePhotoBtn.classList.remove('hidden');
                                capturedPhoto = null;
                            } else {
                                faceStatusP.textContent = 'Превышено количество попыток. Обратитесь к преподавателю.';
                                faceStatusP.classList.add('text-red-500');
                                statusP.textContent = 'Ошибка: Лицо не подтверждено';
                                statusP.classList.remove('text-green-500');
                                statusP.classList.add('text-red-500');
                                stopCamera(true);
                                scanning = true;
                                isVerifyingFace = false;
                            }
                        }
                    } catch (err) {
                        console.error('Ошибка проверки лица:', err);
                        faceStatusP.textContent = 'Ошибка проверки лица: ' + err.message;
                        faceStatusP.classList.add('text-red-500');
                        stopCamera(true);
                        scanning = true;
                        isVerifyingFace = false;
                    }
                };
            } catch (err) {
                console.error('Ошибка проверки лица:', err);
                faceStatusP.textContent = 'Ошибка проверки лица: ' + err.message;
                faceStatusP.classList.add('text-red-500');
                statusP.textContent = 'Ошибка: Проверка лица не удалась';
                statusP.classList.add('text-red-500');
                stopCamera(true);
                scanning = true;
                isVerifyingFace = false;
            }
        }

        async function submitAttendance(qrCode, fullName, group, subject, lectureId) {
            console.log('Отправка данных:', { fullName, group, code: qrCode, subject, lectureId });

            try {
                const response = await fetch(`${serverUrl}/checkAndSave`, {
                    method: 'POST',
                    body: JSON.stringify({ code: qrCode, fullName, group, subject, lectureId }),
                    headers: { 'Content-Type': 'application/json' }
                });

                if (!response.ok) {
                    throw new Error(`HTTP error occurred: ${response.status}`);
                }

                const result = await response.json();
                console.log('Ответ от /checkAndSave:', result);
                if (result.success) {
                    statusP.textContent = 'Отметка успешна!';
                    statusP.classList.remove('text-red-500');
                    statusP.classList.add('text-green-500');
                    stopCamera(true); // Сохраняем сообщение
                    scanning = true;
                    isVerifyingFace = false; // Исправлено с true на false
                } else {
                    statusP.textContent = result.error || 'Ошибка при отправке';
                    statusP.classList.add('text-red-500');
                    stopCamera(true);
                    scanning = true;
                    isVerifyingFace = false;
                }
            } catch (err) {
                console.error('Ошибка сервера:', err);
                statusP.textContent = 'Ошибка сервера: ' + err.message;
                statusP.classList.add('text-red-500');
                stopCamera(true);
                scanning = true;
                isVerifyingFace = false;
            }
        }