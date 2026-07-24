// Sends verification codes and reservation-ready notices. Falls back to
// printing to this server's console when SMTP/Africa's Talking aren't
// configured, so the whole flow is testable locally with zero setup —
// see .env.example.
const nodemailer = require('nodemailer');
const axios = require('axios');

let transporter = null;
function getTransporter() {
    if (!process.env.SMTP_HOST) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
        });
    }
    return transporter;
}

async function sendEmail(to, subject, text) {
    const t = getTransporter();
    if (!t) {
        console.log(`[email:fallback] To: ${to} | Subject: ${subject} | ${text}`);
        return;
    }
    await t.sendMail({ from: process.env.SMTP_FROM || 'Unity Reads <no-reply@unityhomes.co.ke>', to, subject, text });
}

async function sendSms(to, message) {
    if (!process.env.AFRICASTALKING_API_KEY || !process.env.AFRICASTALKING_USERNAME) {
        console.log(`[sms:fallback] To: ${to} | ${message}`);
        return;
    }
    await axios.post(
        'https://api.africastalking.com/version1/messaging',
        new URLSearchParams({ username: process.env.AFRICASTALKING_USERNAME, to, message }).toString(),
        { headers: { apiKey: process.env.AFRICASTALKING_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
}

async function sendVerificationCode(user, code) {
    const message = `Your Unity Reads verification code is ${code}. It expires in 10 minutes.`;
    if (user.accountType === 'Resident') {
        await sendSms(user.phone || user.userId, message);
    } else {
        await sendEmail(user.userId, 'Your Unity Reads verification code', message);
    }
}

async function sendReservationReady(user, bookTitle, branch, hoursToClaim) {
    const message = `"${bookTitle}" is ready for pickup at ${branch}. You have ${hoursToClaim} hours to collect it before it's offered to the next person in line.`;
    if (user.accountType === 'Resident') {
        await sendSms(user.phone || user.userId, message);
    } else {
        await sendEmail(user.userId, 'Your reserved book is ready', message);
    }
}

module.exports = { sendVerificationCode, sendReservationReady };
