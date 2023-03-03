declare module 'node-forge' {
    namespace aes {
        interface cipher {
            start(iv: util.ByteBuffer | string | null, output?: util.ByteBuffer): void;
            update(input: util.ByteBuffer): void;
            finish(): boolean;
            output: util.ByteBuffer;
        }

        function createEncryptionCipher(key: string | util.ByteBuffer, mode?: string): aes.cipher;
    }
}