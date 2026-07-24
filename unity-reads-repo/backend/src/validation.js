// Zod schemas for every route body. Centralized here so a malformed
// request gets a clear 400 before it touches any business logic, instead
// of a scattered manual `if (!req.body.x)` in every route.
const { z } = require('zod');

const hexHash = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a sha256 hex digest.');

const loginSchema = z.object({
    userId: z.string().min(1),
    passcodeHash: hexHash,
    requestedAt: z.string().optional()
});

const registrationSchema = z.object({
    name: z.string().min(1).max(120),
    estateBranch: z.string().min(1),
    accountType: z.enum(['Resident', 'Staff', 'Library Assistant']),
    passcodeHash: hexHash,
    workEmail: z.string().email().optional().or(z.literal('')),
    unitNumber: z.string().optional().or(z.literal('')),
    phone: z.string().optional().or(z.literal('')),
    registeredAt: z.string().optional()
});

const verifySchema = z.object({
    userId: z.string().min(1),
    code: z.string().min(1).max(12)
});

const changePinSchema = z.object({
    userId: z.string().min(1), // accepted for backward compatibility, never trusted — see routes/account.js
    currentPasscodeHash: hexHash,
    newPasscodeHash: hexHash
});

const syncSchema = z.object({
    userId: z.string().optional().default('')
});

const transactionSchema = z.object({
    event: z.enum(['BOOK_BORROWED', 'BOOK_RETURNED']),
    timestamp: z.string().optional(),
    user: z.unknown().optional(), // accepted for backward compatibility, never trusted — see routes/transactions.js
    data: z.object({
        copyId: z.string().min(1),
        titleId: z.string().optional(),
        title: z.string().optional(),
        branch: z.string().optional(),
        loanId: z.string().optional(),
        borrowedAt: z.string().optional(),
        returnedAt: z.string().optional()
    })
});

const reserveSchema = z.object({
    userId: z.string().optional(),
    titleId: z.string().min(1),
    branch: z.string().min(1)
});

const cancelReservationSchema = z.object({
    userId: z.string().optional(),
    reservationId: z.string().min(1)
});

function validateBody(schema) {
    return (req, res, next) => {
        const result = schema.safeParse(req.body);
        if (!result.success) {
            return res.status(400).json({
                message: 'Malformed request.',
                issues: result.error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))
            });
        }
        req.body = result.data;
        next();
    };
}

module.exports = {
    loginSchema, registrationSchema, verifySchema, changePinSchema,
    syncSchema, transactionSchema, reserveSchema, cancelReservationSchema,
    validateBody
};
