import { v2 as cloudinary } from 'cloudinary';
import { createHash } from 'crypto';

let configured = false;

function ensureConfigured(): void {
  if (configured) return;

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('cloudinary_not_configured');
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });

  configured = true;
}

export interface UploadSignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  publicId: string;
  uploadUrl: string;
  allowedFormats: string;
  maxFileSize: number;
  type: 'authenticated';
}

export function generateUploadSignature(invoiceId: string): UploadSignature {
  ensureConfigured();

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `johnpay/proofs/${invoiceId}`;
  const publicId = `${invoiceId}_${timestamp}`;
  const type = 'authenticated';
  const allowedFormats = 'jpg,jpeg,png,webp';
  const maxFileSize = parseInt(process.env.MAX_PROOF_SIZE_MB || '5', 10) * 1024 * 1024;

  const paramsToSign: Record<string, string | number> = {
    timestamp,
    folder,
    public_id: publicId,
    type,
    allowed_formats: allowedFormats,
  };

  const apiSecret = process.env.CLOUDINARY_API_SECRET!;
  const sortedKeys = Object.keys(paramsToSign).sort();
  const stringToSign = sortedKeys.map((k) => `${k}=${paramsToSign[k]}`).join('&');
  const signature = createHash('sha1').update(stringToSign + apiSecret).digest('hex');

  return {
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    folder,
    publicId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/auto/upload`,
    allowedFormats,
    maxFileSize,
    type,
  };
}

export async function deleteProof(publicId: string): Promise<boolean> {
  ensureConfigured();
  try {
    await cloudinary.uploader.destroy(publicId, { type: 'authenticated', invalidate: true });
    return true;
  } catch {
    return false;
  }
}

export function buildPrivateUrl(publicId: string): string {
  ensureConfigured();
  return cloudinary.url(publicId, {
    type: 'authenticated',
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}