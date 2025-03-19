const imageStorage = new Map();
let imageCounter = 0;

/**
 * 保存图片到内存中
 * @param {string} base64Data base64 数据
 * @param {string} mediaType 媒体类型 ("image/jpeg")
 * @returns {{ imageId: string, mediaType: string }} 返回图片信息
 */
export function storeImage(base64Data, mediaType) {
    const randomPart = Math.floor(Math.random() * 10000);
    const imageId = `image_${Date.now()}_${imageCounter++}_${randomPart}`;

    imageStorage.set(imageId, { imageId, base64Data, mediaType });
    // console.log(`Image stored with ID: ${imageId}, Media Type: ${mediaType}`);
    // 打印存储的 base64
    // console.log(`Base64 Data for Image ID ${imageId}: ${base64Data.substring(0, 100)}...`);

    return { imageId, mediaType };
}

/**
 * 获取图片数据
 * @param {string} imageId 图片 ID
 * @returns {object|null} base64 数据和媒体类型
 */
export function getImage(imageId) {
    return imageStorage.get(imageId) || null;
}

/**
 * 获取最后一个图片
 * @returns {object|null} base64 数据和媒体类型
 */
export function getLastImage() {
    const lastKey = Array.from(imageStorage.keys()).pop();
    return lastKey ? imageStorage.get(lastKey) : null;
}

/**
 * 删除图片数据
 * @param {string} imageId 图片 ID
 */
export function removeImage(imageId) {
    imageStorage.delete(imageId);
}

/**
 * 清空所有存储的图片
 */
export function clearAllImages() {
    imageStorage.clear();
    imageCounter = 0;
    // console.log("All images have been cleared from memory.");
}

/**
 * 打印所有存储的图片
 */
export function printAllImages() {
    console.log('Current images stored in memory:');
    imageStorage.forEach((value, key) => {
        console.log(`Image ID: ${key}, Media Type: ${value.mediaType}`);
        console.log(`Base64 Data: ${value.base64Data.substring(0, 100)}...`);
    });
}
