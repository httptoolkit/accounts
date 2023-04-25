import * as _ from 'lodash';
import * as React from 'react';
import { observer } from 'mobx-react-lite';
import { parseISO } from 'date-fns';

import { styled } from './styles';

import type {
    Transaction
} from '../../module/src/auth';

import {
    getPlanByCode
} from '../../module/src/plans';

export const Transactions = observer((p: {
    transactions: Transaction[],
}) => <TransactionsContainer>
    { p.transactions.map((transaction) => <li key={transaction.orderId}>
        <TransactionRow
            href={transaction.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
        >
            <TransactionDescription>
                {
                    getPlanByCode(transaction.sku)?.name
                    ?? 'Unknown'
                }
            </TransactionDescription>

            <TransactionDate>
                { parseISO(transaction.createdAt).toLocaleDateString() }
            </TransactionDate>

            <TransactionResultWrapper>
                <TransactionResult status={transaction.status}>
                    { _.startCase(transaction.status) }
                </TransactionResult>
            </TransactionResultWrapper>

            <TransactionCost>
                { new Intl.NumberFormat(undefined, {
                    style: 'currency',
                    currency: transaction.currency
                }).format(parseFloat(transaction.amount)) }
            </TransactionCost>
        </TransactionRow>
    </li>) }
</TransactionsContainer>);

export const PlaceholderTransactions = () => <TransactionsContainer>
    { _.range(6).map((i) => <li key={i}>
        <PlaceholderTransactionRow />
    </li>) }
</TransactionsContainer>;

const TransactionsContainer = styled.ol`
    list-style: none;
    margin-top: 10px;
`;

const TransactionRow = styled.a`
    text-decoration: none;
    color: ${p => p.theme.mainColor};
    cursor: pointer;

    display: grid;
    grid-template-columns: 1fr 1fr 1fr 1fr;

    border-radius: 4px;
    background-color: ${p => p.theme.mainBackground};
    box-shadow: 0 2px 10px 0 rgb(0 0 0 / 20%);

    padding: 10px 15px;
    margin: 10px 0;

    &:hover {
        box-shadow: none;
    }

    font-size: ${p => p.theme.textSize};
`;

const PlaceholderTransactionRow = styled(TransactionRow)`
    height: 43px;

    li:nth-child(1) > & { opacity: 0.9; }
    li:nth-child(2) > & { opacity: 0.7; }
    li:nth-child(3) > & { opacity: 0.5; }
    li:nth-child(4) > & { opacity: 0.3; }
    li:nth-child(5) > & { opacity: 0.2; }
    li:nth-child(6) > & { opacity: 0.1; }
`;

const TransactionDescription = styled.p`
    padding: 4px 0;
`;

const TransactionDate = styled.p`
    padding: 4px 0;
    text-align: center;
`;

const TransactionResultWrapper = styled.div`
    text-align: center;
`;

const TransactionResult = styled.p<{ status: string }>`
    display: inline-block;
    border-radius: 4px;
    padding: 4px 8px;

    background-color: ${p => p.status === 'completed'
        ? p.theme.successBackground
        : p.theme.warningBackground
    };

    color: ${p => p.status === 'completed'
        ? p.theme.successColor
        : p.theme.warningColor
    };
`;

const TransactionCost = styled.p`
    padding: 4px 0;
    text-align: right;
`;