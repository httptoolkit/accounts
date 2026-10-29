// Formatter construction is far more expensive than formatting, and these are used in
// components that re-render on every keystroke, so we build one per currency and reuse:
const priceFormatters: { [currency: string]: Intl.NumberFormat } = {};

export const formatPrice = (currency: string, amount: number) => {
    priceFormatters[currency] ??= new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency
    });

    return priceFormatters[currency].format(amount);
};
