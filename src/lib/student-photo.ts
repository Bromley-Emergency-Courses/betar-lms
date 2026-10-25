export const studentPhotoLimit = 10 * 1024 * 1024;
export const studentPhotoTypes = ["image/png", "image/jpeg", "image/webp"];
export interface PhotoSnapshot { revision: number; hasPhoto: boolean }

export function validateStudentPhoto(file: File) {
  if (!file.size) throw new Error("Choose a student photo to upload.");
  if (!studentPhotoTypes.includes(file.type)) throw new Error("Student photos must be PNG, JPG, or WEBP images.");
  if (file.size > studentPhotoLimit) throw new Error("Student photos must be 10MB or smaller.");
}

export async function validateStudentPhotoSignature(file: File) {
  validateStudentPhoto(file);
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!(file.type === "image/png" ? png : file.type === "image/jpeg" ? jpeg : webp)) throw new Error("The file contents do not match the selected image format. Choose a PNG, JPG, or WEBP photo.");
}
