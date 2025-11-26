import { authenticator, totp } from "otplib";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../prisma/generated/client";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";

// Generate backup codes (10 codes, each 8 characters)
export function generateBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase();
    codes.push(code);
  }
  return codes;
}

// Hash backup codes for storage
export async function hashBackupCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((code) => bcrypt.hash(code, 10)));
}

// Verify backup code
export async function verifyBackupCode(
  hashedCodes: string[],
  code: string
): Promise<boolean> {
  for (const hashed of hashedCodes) {
    if (await bcrypt.compare(code, hashed)) {
      return true;
    }
  }
  return false;
}

// Generate TOTP secret and QR code
export async function setupMFA(
  prisma: PrismaClient,
  userId: string,
  email: string
): Promise<{ secret: string; qrCode: string; backupCodes: string[] }> {
  // Generate secret
  const secret = authenticator.generateSecret();
  const serviceName = "Record Platform";
  const accountName = email;

  // Generate backup codes
  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = await hashBackupCodes(backupCodes);

  // Create or update MFA settings
  await prisma.$queryRaw`
    INSERT INTO auth.mfa_settings (user_id, totp_secret, backup_codes, enabled, created_at, updated_at)
    VALUES (${userId}::uuid, ${secret}, ${hashedBackupCodes}::text[], false, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET totp_secret = EXCLUDED.totp_secret,
        backup_codes = EXCLUDED.backup_codes,
        updated_at = NOW()
  `;

  // Generate QR code
  const otpAuthUrl = authenticator.keyuri(accountName, serviceName, secret);
  const qrCode = await QRCode.toDataURL(otpAuthUrl);

  return { secret, qrCode, backupCodes };
}

// Verify TOTP code
export async function verifyMFA(
  prisma: PrismaClient,
  userId: string,
  code: string
): Promise<boolean> {
  // Get MFA settings
  const mfaSettings = await prisma.$queryRaw<Array<{
    totp_secret: string;
    backup_codes: string[];
    enabled: boolean;
  }>>`
    SELECT totp_secret, backup_codes, enabled
    FROM auth.mfa_settings
    WHERE user_id = ${userId}::uuid
    LIMIT 1
  `.then((r: any[]) => r[0] || null);

  if (!mfaSettings || !mfaSettings.enabled) {
    return false;
  }

  // Try TOTP first
  try {
    const isValid = authenticator.verify({
      token: code,
      secret: mfaSettings.totp_secret,
    });
    if (isValid) return true;
  } catch (e) {
    // Invalid code format, try backup code
  }

  // Try backup code
  const isBackupCode = await verifyBackupCode(mfaSettings.backup_codes, code);
  if (isBackupCode) {
    // Remove used backup code
    const remainingCodes = mfaSettings.backup_codes.filter(
      async (hashed) => !(await bcrypt.compare(code, hashed))
    );
    await prisma.$queryRaw`
      UPDATE auth.mfa_settings
      SET backup_codes = ${remainingCodes}::text[],
          updated_at = NOW()
      WHERE user_id = ${userId}::uuid
    `;
    return true;
  }

  return false;
}

// Enable MFA
export async function enableMFA(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  await prisma.$queryRaw`
    UPDATE auth.mfa_settings
    SET enabled = true, updated_at = NOW()
    WHERE user_id = ${userId}::uuid
  `;

  await prisma.$queryRaw`
    UPDATE auth.users
    SET mfa_enabled = true, updated_at = NOW()
    WHERE id = ${userId}::uuid
  `;
}

// Disable MFA
export async function disableMFA(
  prisma: PrismaClient,
  userId: string
): Promise<void> {
  await prisma.$queryRaw`
    UPDATE auth.mfa_settings
    SET enabled = false, updated_at = NOW()
    WHERE user_id = ${userId}::uuid
  `;

  await prisma.$queryRaw`
    UPDATE auth.users
    SET mfa_enabled = false, updated_at = NOW()
    WHERE id = ${userId}::uuid
  `;
}

