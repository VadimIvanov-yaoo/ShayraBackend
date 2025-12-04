import models from '../models/models.js'
const {
    User,
    Dialog,
    DialogMember,
    Message,
    MessageReaction,
    BlockedDialog,
} = models
import ApiError from '../error/ApiError.js'
import { Op } from 'sequelize'
import * as path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import * as fs from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function validateDialogAccess(userId, dialogId) {
    const dialog = await Dialog.findOne({
        where: {
            id: dialogId,
            type: 'dialog',
            [Op.or]: [{ creatorId: userId }, { participantId: userId }]
        }
    })
    return !!dialog
}

async function validateMessageAccess(userId, messageId) {
    const message = await Message.findOne({
        where: { id: messageId },
        include: [{
            model: Dialog,
            where: {
                type: 'dialog',
                [Op.or]: [{ creatorId: userId }, { participantId: userId }]
            }
        }]
    })
    return !!message
}

class ChatController {
    async createChat(req, res, next) {
        try {
            const { userId1, userId2 } = req.body
            const currentUserId = req.user.id

            if (!userId1 || !userId2) {
                return res.status(400).json({ message: 'Оба userId обязательны' })
            }

            if (currentUserId !== parseInt(userId1)) {
                return res.status(403).json({ message: 'Недостаточно прав для создания чата от имени другого пользователя' })
            }

            const existingDialog = await Dialog.findOne({
                where: {
                    type: 'dialog',
                    [Op.or]: [
                        { creatorId: userId1, participantId: userId2 },
                        { creatorId: userId2, participantId: userId1 },
                    ],
                },
            })

            if (existingDialog) {
                console.log('Чат уже существует')
                return res.json(existingDialog)
            }

            const creatorUser = await User.findByPk(userId1)
            const participantUser = await User.findByPk(userId2)

            if (!creatorUser || !participantUser) {
                return res.status(404).json({ message: 'Пользователь не найден' })
            }

            const newDialog = await Dialog.create({
                type: 'dialog',
                creatorId: userId1,
                participantId: userId2,
                creatorName: creatorUser.userName,
                participantName: participantUser.userName,
            })

            await DialogMember.bulkCreate([
                { dialogId: newDialog.id, userId: userId1 },
                { dialogId: newDialog.id, userId: userId2 },
            ])

            const io = req.app.get('socketio')
            console.log(io)
            if (io) {
                io.to(`user:${userId1}`).emit('chatCreated', {
                    id: newDialog.id,
                    chatName: participantUser.userName,
                    avatarUrl: participantUser.avatarUrl || '',
                    otherId: userId2,
                    status: participantUser.status || 'offline',
                })

                io.to(`user:${userId2}`).emit('newChatNotification', {
                    dialogId: newDialog.id,
                    participantId: userId1,
                    participantName: creatorUser.userName,
                    participantAvatar: creatorUser.avatarUrl || '',
                    status: creatorUser.status || 'offline',
                })
            }

            return res.json(newDialog)
        } catch (error) {
            next(ApiError.internal('Ошибка создания чата'))
            return res
                .status(500)
                .json({ message: 'Внутренняя ошибка сервера', error: error.message })
        }
    }

    async deleteChat(req, res, next) {
        try {
            const { chatId } = req.body
            const currentUserId = req.user.id

            if (!chatId) {
                return next(ApiError.badRequest('Не указан ID чата'))
            }

            const hasAccess = await validateDialogAccess(currentUserId, chatId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к чату' })
            }

            const dialog = await Dialog.findByPk(chatId)
            if (!dialog) {
                return res.status(404).json({ message: 'Чат не найден' })
            }

            const io = req.app.get('socketio')

            const dialogMember = await DialogMember.destroy({
                where: { dialogId: chatId },
            })

            const deleteDialog = await Dialog.destroy({
                where: { id: chatId },
            })

            if (io && dialog) {
                io.to(`user:${dialog.creatorId}`).emit('chatDeleted', { chatId })
                io.to(`user:${dialog.participantId}`).emit('chatDeleted', { chatId })
            }

            return res.json({ success: true, message: 'Чат удален' })
        } catch (e) {
            console.error(e)
            next(ApiError.internal('Чат не удален'))
        }
    }

    async getChats(req, res, next) {
        try {
            const userId = req.user.id
            const dialogs = await Dialog.findAll({
                where: {
                    type: 'dialog',
                    [Op.or]: [{ creatorId: userId }, { participantId: userId }],
                },
                include: [
                    {
                        model: User,
                        as: 'creator',
                        attributes: ['id', 'userName', 'avatarUrl', 'status'],
                    },
                    {
                        model: User,
                        as: 'participant',
                        attributes: ['id', 'userName', 'avatarUrl', 'status'],
                    },
                ],
            })

            const result = dialogs.map((dialog) => {
                const other =
                    dialog.creatorId === userId ? dialog.participant : dialog.creator

                return {
                    dialogId: dialog.id,
                    participantId: other.id,
                    chatName: other.userName,
                    participantAvatar: other.avatarUrl,
                    status: other.status,
                }
            })

            return res.json(result)
        } catch (e) {
            console.error(e)
            next(ApiError.internal('Чаты не найдены'))
        }
    }

    async blockedChat(req, res, next) {
        try {
            const { dialogId, userId } = req.body
            const currentUserId = req.user.id

            if (parseInt(userId) !== currentUserId) {
                return res.status(403).json({ message: 'Недостаточно прав' })
            }

            const hasAccess = await validateDialogAccess(currentUserId, dialogId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к чату' })
            }

            console.log(dialogId, 'dialogId', userId, 'kjdhfjksdhflshflsdhfjlds')
            const existingBlockedDialog = await BlockedDialog.findOne({
                where: { dialogId, userId },
            })

            if (existingBlockedDialog) {
                return next(ApiError.internal('Чат уже заблокирован'))
            }

            const blockedDialog = await BlockedDialog.create({
                dialogId: dialogId,
                userId: userId,
            })
            console.log('chat is blocked')
            return res.json(blockedDialog)
        } catch (e) {
            console.error(e)
            next(ApiError.internal('Чаты не найдены'))
        }
    }

    async unBlockedChat(req, res, next) {
        try {
            const { dialogId, userId } = req.body
            const currentUserId = req.user.id

            if (parseInt(userId) !== currentUserId) {
                return res.status(403).json({ message: 'Недостаточно прав' })
            }

            const hasAccess = await validateDialogAccess(currentUserId, dialogId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к чату' })
            }

            const existingBlockedDialog = await BlockedDialog.findOne({
                where: { dialogId, userId },
            })

            if (!existingBlockedDialog) {
                return next(ApiError.internal('Чат уже разблокирован'))
            }

            const blockedDialog = await BlockedDialog.destroy({
                where: { dialogId, userId },
            })

            return res.json(blockedDialog)
        } catch (e) {
            console.error(e)
            next(ApiError.internal('Чаты не найдены'))
        }
    }

    async checkBlockedChat(req, res, next) {
        try {
            const { dialogId, userId } = req.body
            const currentUserId = req.user.id

            if (parseInt(userId) !== currentUserId) {
                return res.status(403).json({ message: 'Недостаточно прав' })
            }

            const hasAccess = await validateDialogAccess(currentUserId, dialogId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к чату' })
            }

            const blockedDialog = await BlockedDialog.findOne({
                where: { dialogId, userId },
            })

            if (blockedDialog) {
                return res.json({ blocked: true, userBlocked: userId || null })
            } else {
                return res.json({ blocked: false })
            }
        } catch (e) {
            console.error(e)
            next(ApiError.internal('Ошибка проверки блокировки чата'))
        }
    }

    async uploadImage(req, res, next) {
        try {
            if (!req.files || !req.files.file) {
                return res.status(400).json({ message: 'Файл не выбран' })
            }

            const file = req.files.file
            const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
            const maxSize = 10 * 1024 * 1024

            if (!allowedTypes.includes(file.mimetype)) {
                return res.status(400).json({ message: 'Недопустимый тип файла' })
            }

            if (file.size > maxSize) {
                return res.status(400).json({ message: 'Файл слишком большой. Максимальный размер: 10MB' })
            }

            console.log('Файл пришёл:', file.name, file.size)

            const ext = path.extname(file.name)
            const fileName = uuidv4() + ext
            const uploadDir = resolve(__dirname, '..', 'static')

            console.log('Папка загрузки:', uploadDir)
            if (!fs.existsSync(uploadDir)) {
                console.log('Папка создана')
                fs.mkdirSync(uploadDir, { recursive: true })
            }
            const uploadPath = path.join(uploadDir, fileName)
            await file.mv(uploadPath)

            console.log('Файл сохранён:', uploadPath)
            return res.json({ filePath: fileName })
        } catch (e) {
            console.error('Ошибка при загрузке файла:', e)
            next(e)
        }
    }

    async getMessage(req, res, next) {
        try {
            const { dialogId } = req.query
            const currentUserId = req.user.id

            if (!dialogId) {
                return res.status(400).json({ message: 'Не указан ID диалога' })
            }

            const hasAccess = await validateDialogAccess(currentUserId, dialogId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к диалогу' })
            }

            const foundMessage = await Message.findAll({
                where: { dialogId },
                order: [['id', 'ASC']],
            })
            return res.json(foundMessage)
        } catch (e) {
            next(ApiError.internal('Сообщения не найдены'))
        }
    }

    async getPartnerInfo(req, res, next) {
        try {
            const { id } = req.query
            const currentUserId = req.user.id

            if (!id) {
                return res.status(400).json({ message: 'Не указан ID пользователя' })
            }

            const hasDialog = await Dialog.findOne({
                where: {
                    type: 'dialog',
                    [Op.or]: [
                        { creatorId: currentUserId, participantId: id },
                        { creatorId: id, participantId: currentUserId }
                    ]
                }
            })

            if (!hasDialog) {
                return res.status(403).json({ message: 'Нет общего диалога с пользователем' })
            }

            const foundPartner = await User.findOne({
                where: { id },
                attributes: ['id', 'userName', 'avatarUrl', 'status'],
            })
            return res.json(foundPartner)
        } catch (e) {
            next(ApiError.internal('Данные собеседника не найдены'))
            console.log(e)
        }
    }

    async getLastedChatMessage(req, res, next) {
        try {
            let { chatIds } = req.body
            const currentUserId = req.user.id

            if (!Array.isArray(chatIds)) {
                chatIds = [chatIds]
            }

            const validChatIds = []
            for (const chatId of chatIds) {
                const hasAccess = await validateDialogAccess(currentUserId, chatId)
                if (hasAccess) {
                    validChatIds.push(chatId)
                }
            }

            const lastMessages = await Promise.all(
                validChatIds.map(async (chatId) => {
                    return await Message.findOne({
                        where: { dialogId: chatId },
                        order: [['timestamp', 'DESC']],
                    })
                })
            )
            res.json(lastMessages.filter(msg => msg !== null))
        } catch (e) {
            next(ApiError.internal('Последние сообщения не найдены'))
            console.error(e)
        }
    }

    async deleteMessage(req, res, next) {
        try {
            const messageId = req.body.id
            const currentUserId = req.user.id

            if (!messageId) {
                return res.status(400).json({ message: 'Не указан ID сообщения' })
            }

            const hasAccess = await validateMessageAccess(currentUserId, messageId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к сообщению' })
            }

            const message = await Message.findOne({ where: { id: messageId } })
            if (message.senderId !== currentUserId) {
                return res.status(403).json({ message: 'Можно удалять только свои сообщения' })
            }

            await Message.destroy({ where: { id: messageId } })
            return res.json({ success: true })
        } catch (e) {
            next(ApiError.internal('Удаление не выполнено'))
            console.error(e)
        }
    }

    async readMessageStatus(req, res, next) {
        try {
            const { dialogId, userId } = req.body
            const currentUserId = req.user.id

            if (parseInt(userId) !== currentUserId) {
                return res.status(403).json({ message: 'Недостаточно прав' })
            }

            const hasAccess = await validateDialogAccess(currentUserId, dialogId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к чату' })
            }

            await Message.update(
                { isRead: true },
                {
                    where: {
                        dialogId,
                        senderId: { [Op.ne]: userId },
                    },
                }
            )

            return res.json({ success: true })
        } catch (e) {
            console.error(e)
            next(ApiError.internal('Статус не поменян'))
        }
    }

    async getMessageReaction(req, res, next) {
        try {
            const { messageId, dialogId } = req.query
            const currentUserId = req.user.id

            if (!messageId || !dialogId) {
                return res.status(400).json({ message: 'Не указаны обязательные параметры' })
            }

            const hasAccess = await validateDialogAccess(currentUserId, dialogId)
            if (!hasAccess) {
                return res.status(403).json({ message: 'Нет доступа к диалогу' })
            }

            const reaction = await MessageReaction.findAll({
                where: {
                    messageId: messageId,
                },
            })

            return res.json(reaction)
        } catch (e) {
            console.log(e)
            next(ApiError.internal('Статус не найден'))
        }
    }
}

const chatController = new ChatController()

export default chatController