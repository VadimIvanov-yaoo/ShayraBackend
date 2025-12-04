import models from '../models/models.js'
import { Op } from 'sequelize'
import ApiError from '../error/ApiError.js'
const { Message, User, Dialog, BlockedDialog, MessageReaction } = models

export default function initSocket(io) {
    function validateUserAccess(userId, dialogId) {
        return Dialog.findOne({
            where: {
                id: dialogId,
                type: 'dialog',
                [Op.or]: [{ creatorId: userId }, { participantId: userId }]
            }
        })
    }

    async function getChatPartners(userId) {
        const dialogs = await Dialog.findAll({
            where: {
                type: 'dialog',
                [Op.or]: [{ creatorId: userId }, { participantId: userId }],
            },
        })

        return dialogs.map((d) =>
            d.creatorId === userId ? d.participantId : d.creatorId
        )
    }

    io.on('connection', (socket) => {
        console.log('a user connected')

        socket.on('onlineUser', async (userId) => {
            try {
                const user = await User.findByPk(userId)
                if (!user) return

                socket.userId = userId
                socket.join(`user:${userId}`)
                user.status = 'online'
                await user.save()
                console.log('user online', socket.userId)

                const partners = await getChatPartners(userId)
                partners.forEach((pid) => {
                    io.to(`user:${pid}`).emit('statusChange', { userId, status: 'online' })
                })
            } catch (e) {
                console.error('Ошибка обновления статуса онлайн:', e)
            }
        })

        socket.on('newMessage', async (data) => {
            try {
                const hasAccess = await validateUserAccess(data.senderId, data.dialogId)
                if (!hasAccess) {
                    console.error('Unauthorized message attempt from user:', data.senderId, 'to dialog:', data.dialogId)
                    return
                }

                const message = await Message.create({
                    text: data.type === 'text' ? data.text : null,
                    imgPath: data.type === 'image' ? data.content : null,
                    type: data.type,
                    senderId: data.senderId,
                    dialogId: data.dialogId,
                    time: data.time,
                    isRead: false,

                    isForwarded: data.isForwarded || false,
                    originalSenderId: data.originalSenderId,
                    originalMessageId: data.originalMessageId,
                    forwardedFrom: data.forwardedFrom
                })

                const dialog = await Dialog.findByPk(data.dialogId)
                if (!dialog) {
                    console.error('Dialog not found:', data.dialogId)
                    return
                }

                io.to(`user:${dialog.creatorId}`).emit('messageCreated', message)
                io.to(`user:${dialog.participantId}`).emit('messageCreated', message)
            } catch (e) {
                console.log('Ошибка при отправке сообщения', e)
            }
        })

        socket.on('deleteChat', async (data) => {
            try {
                const { chatId } = data
                const userId = socket.userId

                if (!chatId || !userId) {
                    console.error('Invalid deleteChat data:', data)
                    return
                }

                const hasAccess = await validateUserAccess(userId, chatId)
                if (!hasAccess) {
                    console.error('Unauthorized delete attempt by user:', userId)
                    return
                }

                const dialog = await Dialog.findByPk(chatId)
                if (!dialog) {
                    console.error('Dialog not found:', chatId)
                    return
                }

                io.to(`user:${dialog.creatorId}`).emit('chatDeleted', { chatId })
                io.to(`user:${dialog.participantId}`).emit('chatDeleted', { chatId })

                console.log(`Chat ${chatId} deleted by ${userId}`)
            } catch (e) {
                console.error('Ошибка при удалении чата через сокет:', e)
            }
        })

        socket.on('blockedChat', async (data) => {
            try {
                const { dialogId, userId } = data

                if (!dialogId || !userId) {
                    console.error('Invalid blockedChat data:', data)
                    return
                }

                const hasAccess = await validateUserAccess(userId, dialogId)
                if (!hasAccess) {
                    console.error('Unauthorized block attempt by user:', userId)
                    return
                }

                const existing = await BlockedDialog.findOne({
                    where: { dialogId },
                })
                const blockedMe = await BlockedDialog.findOne({
                    where: { dialogId, userId: userId },
                })

                if (blockedMe) {
                    console.log('vi sablokali')
                    return
                }

                await BlockedDialog.create({
                    dialogId,
                    userId: userId,
                })

                const dialog = await Dialog.findByPk(dialogId)
                if (!dialog) {
                    console.error('Dialog not found:', dialogId)
                    return
                }

                io.to(`user:${dialog.creatorId}`).emit('blockedChatResponse', {
                    dialogId,
                    userBlocked: userId,
                    blocked: true,
                })
                io.to(`user:${dialog.participantId}`).emit('blockedChatResponse', {
                    dialogId,
                    userBlocked: userId,
                    blocked: true,
                })

                console.log(`Chat ${dialogId} blocked by ${userId}`)
            } catch (e) {
                console.error(e)
            }
        })

        socket.on('unBlockedChat', async (data) => {
            try {
                const { dialogId, userId } = data

                if (!dialogId || !userId) {
                    console.error('Invalid unBlockedChat data:', data)
                    return
                }

                const hasAccess = await validateUserAccess(userId, dialogId)
                if (!hasAccess) {
                    console.error('Unauthorized unblock attempt by user:', userId)
                    return
                }

                const meBlockedDialog = await BlockedDialog.findOne({
                    where: { dialogId, userId: userId },
                })

                const findBlockedDialog = await BlockedDialog.findOne({
                    where: { dialogId },
                })

                if (findBlockedDialog && !meBlockedDialog) {
                    console.log(
                        'Вы не можете разблокировать этот чат, так как не являетесь инициатором блокировки'
                    )
                    return
                }

                await BlockedDialog.destroy({
                    where: { dialogId, userId: userId },
                })

                const dialog = await Dialog.findByPk(dialogId)
                if (!dialog) {
                    console.error('Dialog not found:', dialogId)
                    return
                }

                io.to(`user:${dialog.creatorId}`).emit('unBlockedChatResponse', {
                    dialogId,
                    userBlocked: userId,
                    blocked: false,
                })
                io.to(`user:${dialog.participantId}`).emit('unBlockedChatResponse', {
                    dialogId,
                    userBlocked: userId,
                    blocked: false,
                })
            } catch (e) {
                console.error(e)
            }
        })

        socket.on('newReaction', async (data) => {
            try {
                const messageId = data.messageId
                const userId = data.userId
                const emojiId = data.emojiId

                const message = await Message.findByPk(messageId)
                if (!message) {
                    console.error('Message not found')
                    return
                }

                const hasAccess = await validateUserAccess(userId, message.dialogId)
                if (!hasAccess) {
                    console.error('Unauthorized reaction attempt by user:', userId)
                    return
                }

                const repeat = await MessageReaction.findAll({
                    where: { messageId: messageId, userId: userId },
                })

                const dialog = await Dialog.findByPk(message.dialogId)
                if (!dialog) {
                    console.error('Dialog not found for message:', messageId)
                    return
                }

                if (repeat.length !== 0 && emojiId === null) {
                    const deletedCount = await MessageReaction.destroy({
                        where: { messageId: messageId, userId: userId },
                    })
                    io.to(`user:${dialog.creatorId}`).emit('deleteReaction', { messageId, userId })
                    io.to(`user:${dialog.participantId}`).emit('deleteReaction', { messageId, userId })
                }

                if (repeat.length !== 0) {
                    const updatedCount = await MessageReaction.update(
                        { emojiId },
                        {
                            where: { messageId: messageId, userId: userId },
                        }
                    )
                    const updatedReaction = await MessageReaction.findOne({
                        where: { messageId: messageId, userId: userId }
                    })
                    io.emit('reaction', updatedReaction)
                }

                if (repeat.length === 0) {
                    const reaction = await MessageReaction.create({
                        messageId,
                        emojiId,
                        userId,
                    })
                    io.emit('reaction', reaction)
                }
            } catch (e) {
                console.log('Ошибка при отправке реакции', e)
            }
        })

        socket.on('message', (msg) => {
            console.log('message: ' + msg)
        })

        socket.on('disconnect', async () => {
            console.log('user disconnected')
            if (socket.userId) {
                setTimeout(async () => {
                    const user = await User.findByPk(socket.userId)
                    if (!user) return

                    user.status = 'offline'
                    await user.save()
                    console.log('user offline')

                    const partners = await getChatPartners(socket.userId)
                    partners.forEach((pid) => {
                        io.to(`user:${pid}`).emit('statusChange', {
                            userId: socket.userId,
                            status: 'offline',
                        })
                    })
                }, 10000)
            }
        })
    })
}