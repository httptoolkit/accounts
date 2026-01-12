#!./node_modules/.bin/tsx

import * as fs from 'fs';
import csv from 'csv-parser';
import moment from 'moment';
import { parse } from 'path';
import { createObjectCsvWriter as createCsvWriter } from 'csv-writer';

interface RawTransaction {
    date: string;
    description: string;
    amount: number;
    balance: number;
}

interface ProcessedTransaction {
    date: string;
    description: string;
    amount: string;
    balance: string;
}

let rawTransactions: RawTransaction[] = [];
let balance = 0;

// Get the filename from the command line arguments
const filename = process.argv[2];
if (!filename) {
    console.error('Please provide a filename as a command line argument.');
    process.exit(1);
}

fs.createReadStream(filename)
    .pipe(csv())
    .on('data', (row) => {
        let amount = parseFloat(row['Value'].replace('€', ''));
        balance += amount;

        rawTransactions.push({
            date: moment(row['Date (UTC)'], 'MMM D, YYYY').format('DD/MM/YYYY'),
            description: row['Description'],
            amount: amount,
            balance: balance
        });
    })
    .on('end', () => {
        let combinedTransactions: ProcessedTransaction[] = [];

        let combinedAmount = 0;
        let previousTransaction: RawTransaction | undefined;

        for (let transaction of rawTransactions) {
            console.log('Processing transaction:', transaction);
            let { description, amount, balance, date } = transaction;

            // Don't record interest/fee transactions until the last one:
            if (description.startsWith('Interest PAID') || description.startsWith('Service Fee Charged')) {
                console.log('Keeping transaction pending...');
                combinedAmount += amount;
                previousTransaction = transaction;
                continue;
            }

            if (combinedAmount) {
                // We've reached the last interest/fee transaction, so record the combined transaction:
                combinedTransactions.push({
                    date: previousTransaction!.date,
                    description: 'Interest after fees',
                    amount: combinedAmount.toFixed(2),
                    balance: previousTransaction!.balance.toFixed(2)
                });

                combinedAmount = 0;
            }

            // Record the current (non-interest/fee) transaction:
            combinedTransactions.push({
                date: date,
                description: description,
                amount: amount.toFixed(2),
                balance: balance.toFixed(2)
            });
        }

        if (combinedAmount) {
            // We've reached the last interest/fee transaction, so record the combined transaction:
            combinedTransactions.push({
                date: previousTransaction!.date,
                description: 'Interest after fees',
                amount: combinedAmount.toFixed(2),
                balance: previousTransaction!.balance.toFixed(2)
            });
        }

        // Sort from most recent to oldest
        combinedTransactions
            .reverse() // Ensure same-date order is flipped
            .sort((a, b) => moment(b.date, 'DD/MM/YYYY').valueOf() - moment(a.date, 'DD/MM/YYYY').valueOf());

        // Write the output to a file
        const { dir, name } = parse(filename);
        const outputFilename = `${dir}/${name}-processed.csv`;
        const csvWriter = createCsvWriter({
            path: outputFilename,
            header: [
                {id: 'date', title: 'DATE'},
                {id: 'description', title: 'DESCRIPTION'},
                {id: 'amount', title: 'AMOUNT'},
                {id: 'balance', title: 'BALANCE'},
            ]
        });
        csvWriter.writeRecords(combinedTransactions);
    });