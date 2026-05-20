import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";

cloudinary.config({
  cloud_name: env.cloudinaryCloudName,
  api_key: env.cloudinaryApiKey,
  api_secret: env.cloudinaryApiSecret,
  secure: true,
});

function ensureCloudinaryConfigured() {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    throw new Error("Cloudinary is not configured.");
  }
}

export function isSupportedImageUploadSource(value: string) {
  return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value) || /^https?:\/\//i.test(value);
}

export function isSupportedAudioUploadSource(value: string) {
  return /^data:audio\/(webm|mpeg|mp4|wav|ogg);base64,/i.test(value) || /^https?:\/\//i.test(value);
}

export async function uploadProfilePhoto(source: string, userId: bigint): Promise<{ secure_url: string }> {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    if (env.nodeEnv !== "production") {
      return { secure_url: source };
    }

    ensureCloudinaryConfigured();
  }

  try {
    return await cloudinary.uploader.upload(source, {
      folder: `yaaro0/profile-photos/${userId.toString()}`,
      resource_type: "image",
      overwrite: false,
      unique_filename: true,
      use_filename: false,
      transformation: [
        {
          width: 1600,
          height: 1600,
          crop: "limit",
          quality: "auto",
          fetch_format: "auto",
        },
      ],
    });
  } catch (error) {
    if (env.nodeEnv !== "production") {
      console.warn("Cloudinary upload failed; using local development image source.", error);
      return { secure_url: source };
    }

    throw error;
  }
}

export async function uploadChatMedia(
  source: string,
  userId: bigint,
  resourceType: "image" | "video" | "auto" = "auto",
): Promise<{ secure_url: string }> {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    if (env.nodeEnv !== "production") {
      return { secure_url: source };
    }

    ensureCloudinaryConfigured();
  }

  try {
    return await cloudinary.uploader.upload(source, {
      folder: `yaaro0/chat/${userId.toString()}`,
      resource_type: resourceType,
      overwrite: false,
      unique_filename: true,
      use_filename: false,
    });
  } catch (error) {
    if (env.nodeEnv !== "production") {
      console.warn("Cloudinary chat upload failed; using local development media source.", error);
      return { secure_url: source };
    }

    throw error;
  }
}

export async function uploadVerificationSelfie(source: string, userId: bigint): Promise<{ secure_url: string }> {
  if (!env.cloudinaryCloudName || !env.cloudinaryApiKey || !env.cloudinaryApiSecret) {
    if (env.nodeEnv !== "production") {
      return { secure_url: source };
    }

    ensureCloudinaryConfigured();
  }

  try {
    return await cloudinary.uploader.upload(source, {
      folder: `yaaro0/verification/${userId.toString()}`,
      resource_type: "image",
      overwrite: false,
      unique_filename: true,
      use_filename: false,
      transformation: [
        {
          width: 1400,
          height: 1400,
          crop: "limit",
          quality: "auto",
          fetch_format: "auto",
        },
      ],
    });
  } catch (error) {
    if (env.nodeEnv !== "production") {
      console.warn("Cloudinary verification upload failed; using local development image source.", error);
      return { secure_url: source };
    }

    throw error;
  }
}
