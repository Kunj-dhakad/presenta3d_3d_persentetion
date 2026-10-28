-- 3D presentation tables in the PHP app's (CI_Core) database. Creates only p3d_* tables.
-- JSON fields are LONGTEXT so the file also runs on MySQL 5.6 / older MariaDB (no JSON type);
-- the app reads and writes them as JSON text either way. LONGTEXT holds JSON.
-- CreateTable
CREATE TABLE `p3d_users` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `p3d_users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_projects` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(2000) NOT NULL DEFAULT '',
    `category` VARCHAR(191) NOT NULL DEFAULT 'website',
    `framework` VARCHAR(191) NOT NULL DEFAULT 'vanilla',
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `spec` LONGTEXT NULL,
    `sceneSpec` LONGTEXT NULL,
    `isTemplate` BOOLEAN NOT NULL DEFAULT false,
    `lastBuildId` VARCHAR(191) NULL,
    `lastBuildStatus` VARCHAR(191) NULL,
    `lastWorkingBuildId` VARCHAR(191) NULL,
    `lastWorkingVersionId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `p3d_projects_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
    INDEX `p3d_projects_ownerId_status_idx`(`ownerId`, `status`),
    INDEX `p3d_projects_ownerId_category_idx`(`ownerId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_project_files` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `path` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `size` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_project_files_projectId_idx`(`projectId`),
    UNIQUE INDEX `p3d_project_files_projectId_path_key`(`projectId`, `path`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_project_versions` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `summary` LONGTEXT NULL,
    `files` LONGTEXT NOT NULL,
    `fileCount` INTEGER NOT NULL,
    `digest` VARCHAR(191) NOT NULL,
    `isWorking` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_project_versions_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `p3d_project_versions_projectId_digest_idx`(`projectId`, `digest`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_builds` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `versionDigest` VARCHAR(191) NOT NULL,
    `errors` LONGTEXT NULL,
    `warnings` LONGTEXT NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_builds_projectId_createdAt_idx`(`projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_conversations` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `title` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `p3d_conversations_userId_updatedAt_idx`(`userId`, `updatedAt`),
    INDEX `p3d_conversations_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_chat_messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL,
    `content` LONGTEXT NOT NULL,
    `meta` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_chat_messages_conversationId_createdAt_idx`(`conversationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_generation_jobs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `kind` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'queued',
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NULL,
    `input` LONGTEXT NOT NULL,
    `output` LONGTEXT NULL,
    `events` LONGTEXT NULL,
    `error` LONGTEXT NULL,
    `progress` DOUBLE NOT NULL DEFAULT 0,
    `externalId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `finishedAt` DATETIME(3) NULL,

    INDEX `p3d_generation_jobs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `p3d_generation_jobs_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `p3d_generation_jobs_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_assets` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `mimeType` VARCHAR(191) NOT NULL,
    `size` INTEGER NOT NULL,
    `storageKey` VARCHAR(191) NOT NULL,
    `source` VARCHAR(191) NOT NULL,
    `prompt` LONGTEXT NULL,
    `provider` VARCHAR(191) NULL,
    `metadata` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `p3d_assets_storageKey_key`(`storageKey`),
    INDEX `p3d_assets_ownerId_createdAt_idx`(`ownerId`, `createdAt`),
    INDEX `p3d_assets_ownerId_type_idx`(`ownerId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_canvas_documents` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `data` LONGTEXT NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `p3d_canvas_documents_ownerId_updatedAt_idx`(`ownerId`, `updatedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_canvas_versions` (
    `id` VARCHAR(191) NOT NULL,
    `canvasId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `data` LONGTEXT NOT NULL,
    `revision` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_canvas_versions_canvasId_createdAt_idx`(`canvasId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_share_links` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `tokenPrefix` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `p3d_share_links_tokenHash_key`(`tokenHash`),
    INDEX `p3d_share_links_projectId_idx`(`projectId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_deployments` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `provider` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NULL,
    `slug` VARCHAR(191) NULL,
    `buildId` VARCHAR(191) NULL,
    `externalId` VARCHAR(191) NULL,
    `error` LONGTEXT NULL,
    `isPublic` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `p3d_deployments_projectId_createdAt_idx`(`projectId`, `createdAt`),
    INDEX `p3d_deployments_slug_idx`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_usage_records` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NULL,
    `provider` VARCHAR(191) NOT NULL,
    `model` VARCHAR(191) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `requestId` VARCHAR(191) NULL,
    `inputTokens` INTEGER NULL,
    `outputTokens` INTEGER NULL,
    `totalTokens` INTEGER NULL,
    `latencyMs` INTEGER NOT NULL,
    `estimatedCostUsd` DOUBLE NULL,
    `success` BOOLEAN NOT NULL,
    `errorCode` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_usage_records_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `p3d_usage_records_jobId_idx`(`jobId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `p3d_audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `targetType` VARCHAR(191) NULL,
    `targetId` VARCHAR(191) NULL,
    `meta` LONGTEXT NULL,
    `ip` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `p3d_audit_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `p3d_audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `p3d_projects` ADD CONSTRAINT `p3d_projects_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_project_files` ADD CONSTRAINT `p3d_project_files_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_project_versions` ADD CONSTRAINT `p3d_project_versions_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_builds` ADD CONSTRAINT `p3d_builds_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_conversations` ADD CONSTRAINT `p3d_conversations_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_conversations` ADD CONSTRAINT `p3d_conversations_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_chat_messages` ADD CONSTRAINT `p3d_chat_messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `p3d_conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_generation_jobs` ADD CONSTRAINT `p3d_generation_jobs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_generation_jobs` ADD CONSTRAINT `p3d_generation_jobs_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_assets` ADD CONSTRAINT `p3d_assets_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_canvas_documents` ADD CONSTRAINT `p3d_canvas_documents_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_canvas_versions` ADD CONSTRAINT `p3d_canvas_versions_canvasId_fkey` FOREIGN KEY (`canvasId`) REFERENCES `p3d_canvas_documents`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_share_links` ADD CONSTRAINT `p3d_share_links_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_share_links` ADD CONSTRAINT `p3d_share_links_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_deployments` ADD CONSTRAINT `p3d_deployments_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `p3d_projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_usage_records` ADD CONSTRAINT `p3d_usage_records_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `p3d_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `p3d_audit_logs` ADD CONSTRAINT `p3d_audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `p3d_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

