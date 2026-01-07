declare module 'php-serialize' {
    export default class Serializable {
        static serialize(
            item: any,
            phpToJsScope?: Object,
            options?: { encoding: 'utf8' | 'binary' }
        ): string;

        static unserialize(
            item: string,
            scope?: Object,
            options?: { strict: boolean, encoding: 'utf8' | 'binary' }
        ): any

        static isSerialized(
            item: any,
            strict: false
        ): boolean
    }
}