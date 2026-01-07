import * as path from 'path';
import { getLocal } from 'mockttp';

import { PayProOrderDetails, PayProOrderListing } from '../../src/paypro.ts';

export const PAYPRO_API_PORT = 9095;
process.env.PAYPRO_API_BASE_URL = `http://localhost:${PAYPRO_API_PORT}`;

export const payproApiServer = getLocal({
    https: {
        keyPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.key'),
        certPath: path.join(import.meta.dirname, '..', 'fixtures', 'test-ca.pem'),
        keyLength: 2048
    }
});

export function givenPayProOrders(email: string, orders: PayProOrderDetails[]) {
    return Promise.all([
        payproApiServer
        .forPost(`/api/Orders/GetList`)
        .withJsonBodyIncluding({
            search: { customerEmail: email }
        })
        .thenJson(200, {
            isSuccess: true,
            response: {
                orders: orders.map(o => ({
                    id: o.orderId,
                    orderStatusId: o.orderStatusId,
                    orderStatusName: o.orderStatusName,
                    placedAtUtc: o.createdAt,
                    customerBillingEmail: o.customer.email,
                    paymentMethodName: o.paymentMethodName,
                    invoiceUrl: o.invoiceLink
                } as PayProOrderListing))
            }
        }),
        payproApiServer
        .forPost(`/api/Orders/GetOrderDetails`)
        .thenCallback(async (request) => {
            const orderId = (await request.body.getJson() as any).orderId;

            return {
                statusCode: 200,
                json: {
                    isSuccess: true,
                    response: orders.find(o => o.orderId === orderId)
                }
            }
        }),
    ]);
}