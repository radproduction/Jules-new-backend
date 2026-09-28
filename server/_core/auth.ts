import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { ENV } from "./env";
import { USER_ROLES, type SessionPayload } from "./types";

const getJwtSecret = () => {
  if (!ENV.jwtSecret) {
    throw new Error("JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(ENV.jwtSecret);
};

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(
  password: string,
  passwordHash: string
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  const secretKey = getJwtSecret();
  const nowSeconds = Math.floor(Date.now() / 1000);

  return new SignJWT({
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + 60 * 60 * 24 * 365)
    .sign(secretKey);
}

export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const secretKey = getJwtSecret();
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ["HS256"],
    });

    const userId = payload.userId;
    const email = payload.email;
    const role = payload.role;

    if (
      typeof userId !== "number" ||
      typeof email !== "string" ||
      typeof role !== "string" ||
      !USER_ROLES.includes(role as SessionPayload["role"])
    ) {
      return null;
    }

    return {
      userId,
      email,
      role: role as SessionPayload["role"],
    };
  } catch {
    return null;
  }
}
