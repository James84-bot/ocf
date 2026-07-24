const { loginSchema, registrationSchema, transactionSchema } = require('../src/validation');

describe('loginSchema', () => {
    it('accepts a well-formed login body', () => {
        const result = loginSchema.safeParse({ userId: '0712345678', passcodeHash: 'a'.repeat(64) });
        expect(result.success).toBe(true);
    });

    it('rejects a passcodeHash that is not a 64-char hex digest', () => {
        const result = loginSchema.safeParse({ userId: '0712345678', passcodeHash: 'not-a-real-hash' });
        expect(result.success).toBe(false);
    });

    it('rejects a missing userId', () => {
        const result = loginSchema.safeParse({ passcodeHash: 'a'.repeat(64) });
        expect(result.success).toBe(false);
    });
});

describe('registrationSchema', () => {
    it('rejects an invalid accountType rather than silently accepting it', () => {
        const result = registrationSchema.safeParse({
            name: 'Test', estateBranch: 'Unity West', accountType: 'Superuser', passcodeHash: 'a'.repeat(64)
        });
        expect(result.success).toBe(false);
    });

    it('accepts a Resident registration with the fields the frontend actually sends', () => {
        const result = registrationSchema.safeParse({
            name: 'Test Resident', estateBranch: 'Unity West', accountType: 'Resident',
            passcodeHash: 'a'.repeat(64), phone: '0712345678', unitNumber: 'A12'
        });
        expect(result.success).toBe(true);
    });
});

describe('transactionSchema', () => {
    it('rejects an event outside BOOK_BORROWED/BOOK_RETURNED', () => {
        const result = transactionSchema.safeParse({ event: 'BOOK_STOLEN', data: { copyId: 'C00001' } });
        expect(result.success).toBe(false);
    });

    it('requires data.copyId', () => {
        const result = transactionSchema.safeParse({ event: 'BOOK_BORROWED', data: {} });
        expect(result.success).toBe(false);
    });
});
