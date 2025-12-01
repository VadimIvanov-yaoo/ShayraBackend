import bcrypt from 'bcrypt'
import models from '../models/models.js'
const { User, Chat, Dialog } = models
import ApiError from '../error/ApiError.js'
import jwt from 'jsonwebtoken'
import { Op } from 'sequelize'
import { where } from 'sequelize'

function generateJwt(id, email) {
  return jwt.sign({ id, email }, process.env.SECRET_KEY, {
    expiresIn: '24h',
  })
}

class UserController {
  async registration(req, res, next) {
    const { email, password } = req.body
    if (!email || !password) {
      return next(ApiError.badRequest('Некорректный email или пароль'))
    }

    const condidate = await User.findOne({ where: { email } })
    if (condidate) {
      return next(ApiError.badRequest('Пользователь существует'))
    }

    const hashPassword = await bcrypt.hash(password, 5)
    const user = await User.create({ email, password: hashPassword })
    const token = generateJwt(user.id, user.email)
    return res.json({ token })
  }

  async login(req, res, next) {
    const { email, password } = req.body

    const user = await User.findOne({ where: { email } })
    if (!user) {
      return next(ApiError.badRequest('Пользователь не найден'))
    }
    let checkPassword = bcrypt.compareSync(password, user.password)

    if (!checkPassword) {
      return next(ApiError.badRequest('Неверный пароль'))
    }
    const token = generateJwt(user.id, user.email)
    return res.json({ token })
  }

  async check(req, res, next) {
    try {
      const user = await User.findByPk(req.user.id, {
        attributes: ['id', 'email', 'userName', 'avatarUrl', 'status'],
      })
      if (!user) {
        return next(ApiError.badRequest('Пользователь не найден'))
      }
      return res.json(user)
    } catch (e) {
      next(ApiError.internal('Ошибка проверки пользователя'))
    }
  }

  async updateProfile(req, res, next) {
    try {
      const { userName, avatarUrl } = req.body
      const userId = req.user.id

      const user = await User.findByPk(userId)
      if (!user) {
        return next(ApiError.badRequest('Пользователь не найден'))
      }

      if (avatarUrl !== undefined) {
        user.avatarUrl = avatarUrl
      }

      if (userName !== undefined) {
        user.userName = userName
      }

      await user.save()
      return res.json(user)
    } catch (e) {
      next(ApiError.internal('Ошибка обновления профиля'))
    }
  }

  async searchUser(req, res, next) {
    try {
      const { userName } = req.query
      const foundUser = await User.findOne({
        where: { userName },
        attributes: ['id', 'userName', 'avatarUrl'],
      })
      return res.json(foundUser)
    } catch (e) {
      next(ApiError.internal('Пользователи не найдены'))
    }
  }

  async getUserInformation(req, res, next) {
    try {
      let { chatIds } = req.body
      if (!Array.isArray(chatIds)) chatIds = [chatIds]

      const userInfo = await Promise.all(
        chatIds.map(async (chatId) => {
          const user = await User.findOne({
            where: { id: chatId },
            attributes: ['id', 'avatarUrl', 'status'],
          })
          return user ? user : null
        })
      )

      res.json(userInfo.filter(Boolean))
    } catch (e) {
      next(ApiError.internal('Пользователи не найдены'))
      console.error(e)
    }
  }
}

const userController = new UserController()

export default userController
