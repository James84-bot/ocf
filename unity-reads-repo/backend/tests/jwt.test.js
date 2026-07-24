process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-real-deployments';
const jwt = require('jsonwebtoken');
const { signToken } = require('../src/auth');

describe('signToken', () => {
    it('embeds userId and accountType, and nothing else sensitive', () => {
        const token = signToken({ userId: '0712345678', accountType: 'Resident', passcodeHash: 'should-not-leak' });
        const decoded = jwt.decode(token);
        expect(decoded.userId).toBe('0712345678');
        expect(decoded.accountType).toBe('Resident');
        expect(decoded.passcodeHash).toBeUndefined();
    });

    it('produces a token verifiable with the configured secret', () => {
        const token = signToken({ userId: 'a@unityhomes.co.ke', accountType: 'Staff' });
        expect(() => jwt.verify(token, process.env.JWT_SECRET)).not.toThrow();
    });

    it('rejects a token signed with a different secret', () => {
        const token = jwt.sign({ userId: 'x' }, 'a-completely-different-secret');
        expect(() => jwt.verify(token, process.env.JWT_SECRET)).toThrow();
    });
});
