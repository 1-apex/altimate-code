-- SQL injection test patterns for security phase
-- These should be caught/handled gracefully, never executed literally

SELECT * FROM users WHERE id = 1; DROP TABLE users; --
SELECT * FROM users WHERE name = '' OR '1'='1';
SELECT * FROM users WHERE id = 1 UNION SELECT username, password FROM admin_users;
SELECT * FROM users WHERE name = 'Robert''); DROP TABLE students;--';
SELECT LOAD_FILE('/etc/passwd');
SELECT * INTO OUTFILE '/tmp/pwned.txt' FROM users;
