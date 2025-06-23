const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');
const cors = require('cors');
const path = require('path');
const schedule = require('node-schedule');
require('dotenv').config();

const app = express();
const port = 3000;

// промежуточные обработчики
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(path.join(__dirname, 'public/photos')));

// Подключение к PostgreSQL
const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: process.env.PGPORT
});

// Хранилище для QR-кодов и подтверждённых кодов
let qrCodes = [];
const verifiedCodes = new Map();

// Хранилище сессий
const sessions = new Map();

// Очистка журнала каждый день в 00:00
schedule.scheduleJob('0 0 * * *', async () => {
    try {
        await pool.query('DELETE FROM journal');
        console.log('Журнал посещаемости очищен в 00:00');
    } catch (error) {
        console.error('Ошибка при очистке журнала:', error);
    }
});

// Маршрут для аутентификации преподавателя
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body; 
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Логин и пароль требуются' });
        }
        //поиск преподавателя по username в таблице teachers.
        const result = await pool.query('SELECT * FROM teachers WHERE username = $1', [username]);
        const teacher = result.rows[0];
        if (!teacher || !(await bcrypt.compare(password, teacher.password_hash))) {
            console.log('Ошибка аутентификации:', { username });
            return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
        }
        const token = Math.random().toString(36).substring(2); //Генерирует случайный токен для сессии
        sessions.set(token, { username, teacherId: teacher.id, timestamp: Date.now() });
        console.log('Аутентификация успешна:', { username, token, teacherId: teacher.id });
        res.json({ success: true, token, isAdmin: username === 'admin' });
    } catch (error) {
        console.error('Ошибка в /login:', error);
        return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

//запрос на аутентификацию
const authMiddleware = (req, res, next) => {
    const token = req.headers['authorization']; //Извлекает токен из заголовка Authorization.
    if (!token || !sessions.has(token)) { //Проверяет наличие токена и его существование в sessions
        console.log('Ошибка авторизации: неверный или отсутствует токен');
        return res.status(403).json({ success: false, error: 'Требуется авторизация преподавателя' });
    }
    req.teacherId = sessions.get(token).teacherId;
    req.username = sessions.get(token).username;
    next();
};

//админ-доступ
const adminMiddleware = (req, res, next) => {
    if (req.username !== 'admin') {
        console.log('Ошибка: Доступ только для администратора');
        return res.status(403).json({ success: false, error: 'Доступ только для администратора' });
    }
    next();
};

// Обработка запроса на сохранение QR-кода
app.post('/storeCode', authMiddleware, (req, res) => {
    try {
        console.log('Запрос на /storeCode:', req.body);
        const { subject, code, timestamp, lectureId } = req.body;
        if (!subject || !code || !timestamp || !lectureId) {
            console.log('Ошибка: Недостаточно данных');
            return res.status(400).json({ success: false, error: 'Недостаточно данных' });
        }
        qrCodes.push({ subject, code, timestamp, lectureId, teacherId: req.teacherId });//Добавляет QR-код в массив qrCodes с данными и ID преподавателя
        qrCodes = qrCodes.filter(qr => Date.now() - qr.timestamp <= 30000);//Удаляет устаревшие QR-коды
        console.log('Текущие QR-коды:', qrCodes);
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка в /storeCode:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Обработка запроса на проверку QR-кода и отметку посещаемости
app.post('/checkAndSave', async (req, res) => {
    try {
        console.log('Запрос на /checkAndSave:', req.body);
        const { code, fullName, group, subject, lectureId } = req.body;

        // Проверка QR-кода
        if (code && fullName && group && !subject && !lectureId) {
            const qrCode = qrCodes.find(qr => qr.code === code && (Date.now() - qr.timestamp) <= 2000);
            if (!qrCode) {
                console.log('Ошибка: Код не найден или устарел');
                return res.json({ success: false, error: 'Код не найден или устарел' });
            }
            // Проверка студента в базе
            const result = await pool.query(
                'SELECT id, photo_path FROM students WHERE full_name = $1 AND group_name = $2',
                [fullName, group]
            );
            const student = result.rows[0];
            if (!student) {
                console.log('Ошибка: Студент не найден');
                return res.json({ success: false, error: 'Студент не найден' });
            }
            //Если код ещё не подтверждён, создаёт для него пустой массив в verifiedCodes.
            if (!verifiedCodes.has(code)) {
                verifiedCodes.set(code, []);
            }
            //Создаёт объект с данными о подтверждении (ID студента, ФИО, группа и т.д.).
            const studentEntry = { 
                studentId: student.id, 
                fullName, 
                group, 
                timestamp: Date.now(), 
                subject: qrCode.subject, 
                lectureId: qrCode.lectureId,
                teacherId: qrCode.teacherId,
                photoPath: student.photo_path.replace(/^public/, '')
            };
            verifiedCodes.get(code).push(studentEntry); //Добавляет запись о студенте в verifiedCodes для этого кода.
            verifiedCodes.get(code).filter(entry => Date.now() - entry.timestamp <= 100000);
            console.log('Подтверждённые коды:', Array.from(verifiedCodes.entries()));
            return res.json({ success: true, subject: qrCode.subject, lectureId: qrCode.lectureId, photoPath: student.photo_path.replace(/^public/, '') });
        }

        // Полная отметка посещаемости
        if (!code || !fullName || !group || !subject || !lectureId) {
            console.log('Ошибка: Недостаточно данных');
            return res.status(400).json({ success: false, error: 'Недостаточно данных' });
        }

        if (!verifiedCodes.has(code)) { //Проверяет, что код был подтверждён ранее.
            console.log('Ошибка: Код не подтверждён');
            return res.json({ success: false, error: 'Код не подтверждён' });
        }
        //Ищет студента в подтверждённых кодах, который соответствует данным и не устарел.
        const students = verifiedCodes.get(code);
        const verifiedStudent = students.find(
            s => s.fullName === fullName && s.group === group && s.subject === subject && s.lectureId === lectureId && (Date.now() - s.timestamp) <= 100000
        );
        if (!verifiedStudent) {
            console.log('Ошибка: Код не подтверждён или устарел для этого студента');
            return res.json({ success: false, error: 'Код не подтверждён или устарел для этого студента' });
        }

        // Проверка на повторную отметку
        const existingAttendance = await pool.query(
            'SELECT id FROM journal WHERE student_id = $1 AND lecture_id = $2',
            [verifiedStudent.studentId, lectureId]
        );
        if (existingAttendance.rows.length > 0) {
            console.log('Ошибка: Студент уже отметился на этой лекции', { studentId: verifiedStudent.studentId, lectureId });
            return res.json({ success: false, error: 'Вы уже отметились на этой лекции' });
        }

        // Записываем посещаемость в journal
        const query = `
            INSERT INTO journal (lecture_id, teacher_id, subject, student_id, attendance_time)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
        `;
        const values = [lectureId, verifiedStudent.teacherId, subject, verifiedStudent.studentId, new Date().toISOString()];
        const result = await pool.query(query, values);
        console.log('Запись в PostgreSQL успешна:', { id: result.rows[0].id, lectureId, subject, fullName, group });

        // Удаляем запись студента для этого кода
        verifiedCodes.set(code, students.filter(s => s.fullName !== fullName || s.group !== group));
        if (verifiedCodes.get(code).length === 0) {
            verifiedCodes.delete(code);
        }
        console.log('Подтверждённые коды после удаления:', Array.from(verifiedCodes.entries()));
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка в /checkAndSave:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Маршрут для получения списка лекций
app.get('/lectures', authMiddleware, async (req, res) => {
    //Запрашивает уникальные лекции для преподавателя.
    try {
        const result = await pool.query(`
            SELECT DISTINCT lecture_id, subject
            FROM journal
            WHERE teacher_id = $1
            AND DATE(attendance_time) = CURRENT_DATE
            ORDER BY lecture_id
        `, [req.teacherId]);
        res.json({ success: true, lectures: result.rows }); //Возвращает список лекций.
    } catch (error) {
        console.error('Ошибка в /lectures:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Маршрут для получения журнала посещаемости
app.get('/journal', authMiddleware, async (req, res) => {
    try {
        const { lectureId } = req.query;
        let query = `
            SELECT j.id, j.lecture_id, j.subject, s.full_name, s.group_name, j.attendance_time
            FROM journal j
            JOIN students s ON j.student_id = s.id
            WHERE j.teacher_id = $1
            AND DATE(j.attendance_time) = CURRENT_DATE
        `;
        const values = [req.teacherId];
        if (lectureId) { //Если указан lectureId, добавляет условие фильтрации
            query += ' AND j.lecture_id = $2';
            values.push(lectureId);
        }
        query += ' ORDER BY j.attendance_time DESC';
        const result = await pool.query(query, values);
        res.json({ success: true, records: result.rows }); //Возвращает записи.
    } catch (error) {
        console.error('Ошибка в /journal:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Маршрут для экспорта журнала в Excel
app.get('/export-journal', authMiddleware, async (req, res) => {
    try {
        const { lectureId } = req.query;
        console.log('Запрос на /export-journal:', { teacherId: req.teacherId, lectureId });

        let query = `
            SELECT j.lecture_id, j.subject, s.full_name, s.group_name, j.attendance_time
            FROM journal j
            JOIN students s ON j.student_id = s.id
            WHERE j.teacher_id = $1
            AND DATE(j.attendance_time) = CURRENT_DATE
        `;
        const values = [req.teacherId];

        if (lectureId) {//Добавляет фильтр по lectureId
            query += ' AND j.lecture_id = $2';
            values.push(decodeURIComponent(lectureId));
        }
        query += ' ORDER BY j.attendance_time DESC';

        const result = await pool.query(query, values);
        console.log('Результат запроса:', result.rows.length, 'записей');

        //Преобразует записи в формат для Excel.
        const records = result.rows.map(row => ({
            LectureID: row.lecture_id,
            Subject: row.subject,
            FullName: row.full_name,
            Group: row.group_name,
            AttendanceTime: row.attendance_time.toISOString()
        }));

        //Создаёт новую книгу Excel и добавляет лист.
        const ws = XLSX.utils.json_to_sheet(records);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Attendance');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); //Преобразует книгу в буфер (файл .xlsx).


    //Формирует безопасное имя файла, заменяя пробелы и кодируя.
        const safeLectureId = lectureId ? decodeURIComponent(lectureId).replace(/\s+/g, '_') : 'all';
        const encodedFileName = encodeURIComponent(`attendance_${safeLectureId}.xlsx`);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFileName}`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer); //Отправляет файл клиенту.
    } catch (error) {
        console.error('Ошибка в /export-journal:', {
            message: error.message,
            stack: error.stack,
            query: req.query
        });
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Админ-маршруты для управления преподавателями
//GET-маршрут /teachers для получения списка преподавателей
app.get('/teachers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username FROM teachers ORDER BY id');
        res.json({ success: true, teachers: result.rows });
    } catch (error) {
        console.error('Ошибка в /teachers:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});
//POST-маршрут для добавления преподавателя.
app.post('/teachers', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'Логин и пароль требуются' });
        }
        const hashedPassword = await bcrypt.hash(password, 10); //Хеширует пароль.
        const result = await pool.query( //Добавляет преподавателя в БД.
            'INSERT INTO teachers (username, password_hash) VALUES ($1, $2) RETURNING id, username',
            [username, hashedPassword]
        );
        console.log('Преподаватель добавлен:', result.rows[0]);
        res.json({ success: true, teacher: result.rows[0] });
    } catch (error) {
        console.error('Ошибка в POST /teachers:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});
//PUT-маршрут для обновления преподавателя.
app.put('/teachers/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password } = req.body;
        if (!username && !password) {
            return res.status(400).json({ success: false, error: 'Требуется хотя бы одно поле для обновления' });
        }
        //Формирует SQL-запрос.
        let query = 'UPDATE teachers SET ';
        const values = [];
        let paramIndex = 1;

        //Добавляет поля для обновления.
        if (username) {
            query += `username = $${paramIndex++}`;
            values.push(username);
        }
        if (password) {
            if (username) query += ', ';
            const hashedPassword = await bcrypt.hash(password, 10);
            query += `password_hash = $${paramIndex++}`;
            values.push(hashedPassword);
        }
        query += ` WHERE id = $${paramIndex} RETURNING id, username`;
        values.push(id);

        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Преподаватель не найден' });
        }
        console.log('Преподаватель обновлён:', result.rows[0]);
        res.json({ success: true, teacher: result.rows[0] });
    } catch (error) {
        console.error('Ошибка в PUT /teachers:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});
//DELETE-маршрут для удаления преподавателя.
app.delete('/teachers/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM teachers WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Преподаватель не найден' });
        }
        console.log('Преподаватель удалён:', { id });
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка в DELETE /teachers:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Админ-маршруты для управления студентами
app.get('/students', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, full_name, group_name, photo_path FROM students ORDER BY id');
        res.json({ success: true, students: result.rows });
    } catch (error) {
        console.error('Ошибка в /students:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});
//PUT-маршрут для добавления студента.
app.post('/students', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { full_name, group_name, photo_path } = req.body;
        if (!full_name || !group_name || !photo_path) {
            return res.status(400).json({ success: false, error: 'Все поля обязательны' });
        }
        const result = await pool.query(
            'INSERT INTO students (full_name, group_name, photo_path) VALUES ($1, $2, $3) RETURNING id, full_name, group_name, photo_path',
            [full_name, group_name, photo_path]
        );
        console.log('Студент добавлен:', result.rows[0]);
        res.json({ success: true, student: result.rows[0] });
    } catch (error) {
        console.error('Ошибка в POST /students:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});
//PUT-маршрут для обновления студента.
app.put('/students/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, group_name, photo_path } = req.body;
        if (!full_name && !group_name && !photo_path) {
            return res.status(400).json({ success: false, error: 'Требуется хотя бы одно поле для обновления' });
        }
        let query = 'UPDATE students SET ';
        const values = [];
        let paramIndex = 1;

        if (full_name) {
            query += `full_name = $${paramIndex++}`;
            values.push(full_name);
        }
        if (group_name) {
            if (full_name) query += ', ';
            query += `group_name = $${paramIndex++}`;
            values.push(group_name);
        }
        if (photo_path) {
            if (full_name || group_name) query += ', ';
            query += `photo_path = $${paramIndex++}`;
            values.push(photo_path);
        }
        query += ` WHERE id = $${paramIndex} RETURNING id, full_name, group_name, photo_path`;
        values.push(id);

        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Студент не найден' });
        }
        console.log('Студент обновлён:', result.rows[0]);
        res.json({ success: true, student: result.rows[0] });
    } catch (error) {
        console.error('Ошибка в PUT /students:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});
//DELETE-маршрут для удаления студента.
app.delete('/students/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM students WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Студент не найден' });
        }
        console.log('Студент удалён:', { id });
        res.json({ success: true });
    } catch (error) {
        console.error('Ошибка в DELETE /students:', error);
        res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
});

// Очистка устаревших подтверждённых кодов
setInterval(() => {
    for (const [code, students] of verifiedCodes) {
        verifiedCodes.set(code, students.filter(s => Date.now() - s.timestamp <= 100000));
        if (verifiedCodes.get(code).length === 0) {
            verifiedCodes.delete(code);
        }
    }
    console.log('Очистка устаревших кодов. Текущие:', Array.from(verifiedCodes.entries()));
}, 100000);

// Очистка устаревших сессий
setInterval(() => {
    for (const [token, session] of sessions) {
        if (Date.now() - session.timestamp > 3600000) { // 1 час
            sessions.delete(token);
        }
    }
}, 60000);

// Маршрут для корневого пути
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Маршрут для админ-панели
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Запуск сервера
app.listen(port, '0.0.0.0', async () => {
    try {
        await pool.query('SELECT NOW()');
        console.log('Подключение к PostgreSQL установлено');
        console.log(`Сервер запущен на http://0.0.0.0:${port}`);
    } catch (error) {
        console.error('Ошибка подключения к PostgreSQL:', error);
    }
});