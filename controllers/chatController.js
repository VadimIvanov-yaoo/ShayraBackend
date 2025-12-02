import models from '../models/models.js'
const {
  User,
  Chat,
  ChatMember,
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
class ChatController {
  async createChat(req, res, next) {
    try {
      const { userId1, userId2 } = req.body

      if (!userId1 || !userId2) {
        return res.status(400).json({ message: 'Оба userId обязательны' })
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

      if (!chatId) {
        return next(ApiError.badRequest('Не указан ID чата'))
      }
      const dialodMember = await DialogMember.destroy({
        where: { dialogId: chatId },
      })

      const deleteDialog = await Dialog.destroy({
        where: { id: chatId },
      })

      return res.json(deleteDialog)
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
      const ext = path.extname(file.name)
      const fileName = uuidv4() + ext
      const uploadPath = resolve(__dirname, '..', 'static', fileName)
      await file.mv(uploadPath)

      return res.json({ filePath: fileName })
    } catch (e) {
      next(e)
    }
  }

  async getMessage(req, res, next) {
    try {
      const { dialogId } = req.query
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
      if (!Array.isArray(chatIds)) {
        chatIds = [chatIds]
      }
      const lastMessages = await Promise.all(
        chatIds.map(async (chatId) => {
          return await Message.findOne({
            where: { dialogId: chatId },
            order: [['timestamp', 'DESC']],
          })
        })
      )
      res.json(lastMessages)
    } catch (e) {
      next(ApiError.internal('Последние сообщения не найдены'))
      console.error(e)
    }
  }

  async deleteMessage(req, res, next) {
    try {
      const messageId = req.body.id
      await Message.destroy({ where: { id: messageId } })
    } catch (e) {
      next(ApiError.internal('Удаление не выполнено'))
      console.error(e)
    }
  }

  async readMessageStatus(req, res, next) {
    try {
      const { dialogId, userId } = req.body
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
