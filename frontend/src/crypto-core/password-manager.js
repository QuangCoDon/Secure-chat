import { stringToBuffer, bufferToString, encodeBuffer, decodeBuffer, getRandomBytes } from "./lib";
const subtle = window.crypto.subtle;

/********* Constants ********/
const PBKDF2_ITERATIONS = 100000;
const VERIFIER_STRING = "keychain-verification-ok";

/********* Helper Functions ********/
// Hàm dẫn xuất khoá (Key Derivation)
async function _deriveMEK(password, salt_b64) {
  const pwKey = await subtle.importKey(
    "raw",
    stringToBuffer(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: decodeBuffer(salt_b64),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    pwKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// Băm dữ liệu
async function _hash(data) {
  const hashBuffer = await subtle.digest("SHA-256", stringToBuffer(data));
  return encodeBuffer(hashBuffer);
}

/********* Implementation ********/
class Keychain {
  
  constructor(salt, keychainID, verifier, MEK, kvs = {}) {
    this.data = {
      salt: salt,         
      keychainID: keychainID, 
      verifier: verifier,
      kvs: kvs            
    };
    this.secrets = {
      MEK: MEK            
    };
  };

  /** * Tạo Keychain mới
   */
  static async init(password, existingSalt = null) {
    let salt_b64;

    if (existingSalt) {
        // TRƯỜNG HỢP 1: Đăng nhập lại -> Dùng Salt cũ tải từ Server
        salt_b64 = existingSalt;
    } else {
        // TRƯỜNG HỢP 2: Lần đầu tiên -> Tạo Salt mới
        const saltBuffer = getRandomBytes(16);
        salt_b64 = encodeBuffer(saltBuffer);
    }

    const keychainIDBuffer = getRandomBytes(16);
    const keychainID_b64 = encodeBuffer(keychainIDBuffer);

    const MEK = await _deriveMEK(password, salt_b64);

    // Tạo Password Verifier
    const verifier_iv = getRandomBytes(12);
    const verifier_ct_buf = await subtle.encrypt(
      { name: "AES-GCM", iv: verifier_iv },
      MEK,
      stringToBuffer(VERIFIER_STRING)
    );
    const verifier = {
      iv: encodeBuffer(verifier_iv),
      ct: encodeBuffer(verifier_ct_buf)
    };
    const newKeychain = new Keychain(salt_b64, keychainID_b64, verifier, MEK, {});
    
    // Đánh dấu là mới tạo để CryptoService biết đường gửi Salt lên Server
    newKeychain.isNewSalt = !existingSalt; 
    
    return newKeychain;
  }

  // --- [UPDATE 1] HÀM DUMP (Dùng để LƯU) ---
  // Sửa để nhận đầu vào là List Password và trả về Object {encryptedVault, vaultIntegrity}
  async dump(dataList) {
    try {
        // 1. Chuyển List thành JSON string
        // Nếu không có dataList (gọi mặc định), ta lấy kvs nội bộ (logic cũ)
        const contentToEncrypt = dataList ? JSON.stringify(dataList) : JSON.stringify(this.data);
        
        // 2. Tạo IV ngẫu nhiên
        const iv = getRandomBytes(12);

        // 3. Mã hóa toàn bộ danh sách
        const ciphertext = await subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            this.secrets.MEK,
            stringToBuffer(contentToEncrypt)
        );

        // 4. Ghép IV + Ciphertext
        const combined = new Uint8Array(iv.length + ciphertext.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(ciphertext), iv.length);

        // 5. Encode sang Base64
        const encryptedVault = encodeBuffer(combined);

        // 6. Tính Integrity (Checksum)
        const vaultIntegrity = await _hash(encryptedVault);

        // 7. Trả về đúng định dạng UI cần
        return { encryptedVault, vaultIntegrity };

    } catch (e) {
        console.error("Dump Error:", e);
        return { encryptedVault: "", vaultIntegrity: "" };
    }
  };

  // --- [UPDATE 2] HÀM LOAD (Dùng để TẢI) ---
  // Đây là Instance Method (khác với Static load ở dưới)
  // Dùng để UI gọi: keychain.load(enc, int)
  async load(encryptedVault, vaultIntegrity) {
    try {
        if (!encryptedVault) return [];

        // 1. Kiểm tra toàn vẹn dữ liệu
        const computedHash = await _hash(encryptedVault);
        if (computedHash !== vaultIntegrity) {
            throw new Error("Integrity check failed: Data mismatch.");
        }

        // 2. Decode Base64
        const combined = decodeBuffer(encryptedVault);

        // 3. Tách IV (12 byte đầu) và Ciphertext
        const iv = combined.slice(0, 12);
        const ciphertext = combined.slice(12);

        // 4. Giải mã
        const decryptedBuffer = await subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            this.secrets.MEK,
            ciphertext
        );

        // 5. Parse JSON về danh sách
        return JSON.parse(bufferToString(decryptedBuffer));

    } catch (e) {
        console.error("Load Error:", e);
        return []; // Trả về mảng rỗng nếu lỗi
    }
  }

  // --- Logic cũ (Giữ lại để tham khảo hoặc dùng cho Verifier) ---
  static async deserialize(password, repr, trustedDataCheck) {
    // 1. Rollback Attack Defense
    if (trustedDataCheck) {
      const computedCheck = await _hash(repr);
      if (computedCheck !== trustedDataCheck) {
        throw new Error("Integrity check failed: Hashes do not match.");
      }
    }

    // 2. Parse data
    let parsedData;
    try {
      parsedData = JSON.parse(repr);
    } catch (e) {
      throw new Error("Failed to parse keychain data (JSON).");
    }

    if (!parsedData.salt || !parsedData.keychainID || !parsedData.verifier || typeof parsedData.kvs !== 'object') {
      throw new Error("Invalid keychain format: missing required fields.");
    }

    // 3. Derive the MEK.
    const MEK = await _deriveMEK(password, parsedData.salt);

    // 4. KIỂM TRA MẬT KHẨU (Yêu cầu mới của file test)
    // Thử giải mã verifier. Nếu thất bại -> sai mật khẩu.
    try {
      const v_iv = decodeBuffer(parsedData.verifier.iv);
      const v_ct = decodeBuffer(parsedData.verifier.ct);
      
      const pt_buf = await subtle.decrypt(
        { name: "AES-GCM", iv: v_iv },
        MEK,
        v_ct
      );

      if (bufferToString(pt_buf) !== VERIFIER_STRING) {
        throw new Error(); // Dữ liệu verifier bị hỏng
      }
    } catch (e) {
      // Bất kỳ lỗi nào ở đây (decrypt, so sánh) đều có nghĩa là mật khẩu sai
      throw new Error("Invalid password or corrupted keychain.");
    }

    // 5. Create and return the new keychain instance
    return new Keychain(parsedData.salt, parsedData.keychainID, parsedData.verifier, MEK, parsedData.kvs);
  }

  /**
    * Fetches the data.
    */
  async get(name) {
    // Key trong KVS là hash của tên miền
    const key = await _hash(name); 
    const entry = this.data.kvs[key];
    if (!entry) {
      return null;
    }

    try {
      const iv = decodeBuffer(entry.iv);
      const ciphertext = decodeBuffer(entry.ct);
      const aad = this._getAAD(name); // AAD vẫn dùng tên miền gốc

      const decryptedBuffer = await subtle.decrypt(
        {
          name: "AES-GCM",
          iv: iv,
          additionalData: aad
        },
        this.secrets.MEK,
        ciphertext
      );

      return bufferToString(decryptedBuffer);
    } catch (e) {
      throw new Error(`Decryption failed for domain "${name}".`);
    }
  };

  /** * Inserts or updates data.
  */
  async set(name, value) {
    const key = await _hash(name); // Dùng hash làm key
    const iv = getRandomBytes(12);
    const data = stringToBuffer(value);
    const aad = this._getAAD(name); // Dùng tên miền gốc làm AAD

    const ciphertext = await subtle.encrypt(
      {
        name: "AES-GCM",
        iv: iv,
        additionalData: aad
      },
      this.secrets.MEK,
      data
    );

    this.data.kvs[key] = {
      iv: encodeBuffer(iv),
      ct: encodeBuffer(ciphertext)
    };
  };

  /**
    * Removes the record.
  */
  async remove(name) {
    const key = await _hash(name); // Dùng hash làm key
    if (key in this.data.kvs) {
      delete this.data.kvs[key];
      return true;
    } else {
      return false;
    }
  };
};

export { Keychain };