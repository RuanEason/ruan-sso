-- CreateTable
CREATE TABLE `SigningKey` (
    `id` VARCHAR(191) NOT NULL,
    `kid` VARCHAR(191) NOT NULL,
    `alg` VARCHAR(191) NOT NULL DEFAULT 'RS256',
    `publicJwk` JSON NOT NULL,
    `status` ENUM('ACTIVE', 'RETIRED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `retiredAt` DATETIME(3) NULL,

    UNIQUE INDEX `SigningKey_kid_key`(`kid`),
    INDEX `SigningKey_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
