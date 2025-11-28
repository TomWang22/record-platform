import { PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import nodemailer from "nodemailer";
import twilio from "twilio";

// Generate 6-digit verification code
function generateCode(): string {
  return randomInt(100000, 999999).toString();
}

// Hash verification code
async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

// Verify code
async function verifyCode(hashed: string, code: string): Promise<boolean> {
  return bcrypt.compare(code, hashed);
}

// Email transporter (configure via environment variables)
function getEmailTransporter() {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASSWORD;

  if (!smtpUser || !smtpPass) {
    console.warn("SMTP credentials not configured, email verification disabled");
    return null;
  }

  return nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
}

// SMS client (Twilio)
function getSmsClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    console.warn("Twilio credentials not configured, SMS verification disabled");
    return null;
  }

  return twilio(accountSid, authToken);
}

// Send email verification code
export async function sendEmailVerificationCode(
  prisma: PrismaClient,
  userId: string | null,
  email: string
): Promise<{ success: boolean; message?: string }> {
  const code = generateCode();
  const hashedCode = await hashCode(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store code in database
  if (userId) {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        ${userId}::uuid,
        'email',
        ${email},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  } else {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        NULL,
        'email',
        ${email},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  }

  // Send email
  const transporter = getEmailTransporter();
  if (!transporter) {
    return { success: false, message: "Email service not configured" };
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: "Record Platform - Email Verification Code",
      html: `
        <h2>Email Verification</h2>
        <p>Your verification code is: <strong>${code}</strong></p>
        <p>This code will expire in 15 minutes.</p>
        <p>If you didn't request this code, please ignore this email.</p>
      `,
    });
    return { success: true };
  } catch (error: any) {
    console.error("Failed to send email:", error);
    return { success: false, message: error.message };
  }
}

// Send SMS verification code
export async function sendSmsVerificationCode(
  prisma: PrismaClient,
  userId: string | null,
  phone: string
): Promise<{ success: boolean; message?: string }> {
  const code = generateCode();
  const hashedCode = await hashCode(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Store code in database
  if (userId) {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        ${userId}::uuid,
        'phone',
        ${phone},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  } else {
    await prisma.$queryRaw`
      INSERT INTO auth.verification_codes (user_id, type, target, code, expires_at, created_at)
      VALUES (
        NULL,
        'phone',
        ${phone},
        ${hashedCode},
        ${expiresAt}::timestamptz,
        NOW()
      )
    `;
  }

  // Send SMS
  const client = getSmsClient();
  if (!client) {
    return { success: false, message: "SMS service not configured" };
  }

  try {
    await client.messages.create({
      body: `Your Record Platform verification code is: ${code}. This code expires in 15 minutes.`,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: phone,
    });
    return { success: true };
  } catch (error: any) {
    console.error("Failed to send SMS:", error);
    return { success: false, message: error.message };
  }
}

// Verify code
export async function verifyVerificationCode(
  prisma: PrismaClient,
  type: "email" | "phone",
  target: string,
  code: string
): Promise<{ success: boolean; userId?: string; message?: string }> {
  // Find valid code
  const verification = await prisma.$queryRaw<Array<{
    id: string;
    user_id: string | null;
    code: string;
    expires_at: Date;
    used: boolean;
  }>>`
    SELECT id, user_id, code, expires_at, used
    FROM auth.verification_codes
    WHERE type = ${type}
      AND target = ${target}
      AND expires_at > NOW()
      AND used = false
    ORDER BY created_at DESC
    LIMIT 1
  `.then((r: any[]) => r[0] || null);

  if (!verification) {
    return { success: false, message: "Invalid or expired code" };
  }

  // Verify code
  const isValid = await verifyCode(verification.code, code);
  if (!isValid) {
    return { success: false, message: "Invalid code" };
  }

  // Mark as used
  await prisma.$queryRaw`
    UPDATE auth.verification_codes
    SET used = true
    WHERE id = ${verification.id}::uuid
  `;

  // Update user verification status
  if (verification.user_id) {
    if (type === "email") {
      await prisma.$queryRaw`
        UPDATE auth.users
        SET email_verified = true, updated_at = NOW()
        WHERE id = ${verification.user_id}::uuid
      `;
    } else {
      await prisma.$queryRaw`
        UPDATE auth.users
        SET phone_verified = true, updated_at = NOW()
        WHERE id = ${verification.user_id}::uuid
      `;
    }
  }

  return { success: true, userId: verification.user_id || undefined };
}

