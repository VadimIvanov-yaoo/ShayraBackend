import models from '../models/models.js'
import { Model as Model, Op } from 'sequelize'
import ApiError from '../error/ApiError.js'
const { Message, User, Dialog, BlockedDialog, MessageReaction } = models

export default function initSocket(io) {
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
        user.status = 'online'
        await user.save()
        console.log('user online', socket.userId)

        const partners = await getChatPartners(userId)
        partners.forEach((pid) => {
          io.emit('statusChange', { userId, status: 'online' })
        })
      } catch (e) {
        console.error('Ошибка обновления статуса онлайн:', e)
      }
    })

    socket.on('newMessage', async (data) => {
      try {
        const message = await Message.create({
          text: data.type === 'text' ? data.text : null,
          imgPath: data.type === 'image' ? data.content : null,
          type: data.type,
          senderId: data.senderId,
          dialogId: data.dialogId,
          time: data.time,
          isRead: false,
        })
        io.emit('messageCreated', message)
      } catch (e) {
        console.log('Ошибка при отправке сообщения', e)
      }
    })

    socket.on('blockedChat', async (data) => {
      try {
        const { dialogId, userId } = data

        if (!dialogId || !userId) {
          console.error('Invalid blockedChat data:', data)
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

        io.emit('blockedChatResponse', {
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

        io.emit('unBlockedChatResponse', {
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

        const repeat = await MessageReaction.findAll({
          where: { messageId: messageId, userId: userId },
        })

        if (repeat.length !== 0 && emojiId === null) {
          const deletedCount = await MessageReaction.destroy({
            where: { messageId: messageId, userId: userId },
          })
          io.emit('deleteReaction', { messageId, userId })
        }

        if (repeat.length !== 0) {
          const updatedCount = await MessageReaction.update(
            { emojiId },
            {
              where: { messageId: messageId, userId: userId },
            }
          )
          io.emit('updatedCount', updatedCount)
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
        console.log('Ошибка при отправке сообщения', e)
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
            io.emit('statusChange', {
              userId: socket.userId,
              status: 'offline',
            })
          })
        }, 10000)
        try {
        } catch (e) {
          console.error('Ошибка обновления статуса онлайн:', e)
        }
      }
    })
  })
}
