-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_BLOCKED', 'LOGOUT', 'REGISTER', 'CONSENT_GRANTED', 'CONSENT_DENIED', 'CONSENT_REVOKED', 'TOKEN_ISSUED', 'TOKEN_REFRESHED', 'ADMIN_USER_CREATED', 'ADMIN_USER_UPDATED', 'ADMIN_USER_DELETED', 'ADMIN_APP_CREATED', 'ADMIN_APP_UPDATED', 'ADMIN_APP_DELETED', 'ADMIN_ORG_CREATED', 'ADMIN_ORG_UPDATED', 'ADMIN_ORG_DELETED', 'ADMIN_MEMBER_ADDED', 'ADMIN_MEMBER_REMOVED', 'ADMIN_SESSION_REVOKED') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(191) NULL,
    `actorRole` ENUM('ADMIN', 'USER') NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `targetName` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `userAgent` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_actorId_idx`(`actorId`),
    INDEX `AuditLog_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `AuditLog_targetType_targetId_idx`(`targetType`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
