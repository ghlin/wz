import type { WzExtended } from './WzExtended'
import type { WzLuaProperty } from './properties/WzLuaProperty'
import { NotImplementedError } from './util/NotImplementedError'
import type { WzBinaryReader } from './util/WzBinaryReader'
import type { WzFile } from './WzFile'
import { WzImage } from './WzImage'
import { WzObject } from './WzObject'
import { WzObjectType } from './WzObjectType'
import type { WzPropertyType } from './WzPropertyType'

/**
 * @public
 */
export abstract class WzImageProperty extends WzObject {
  /**
   * @virtual
   */
  public get wzProperties (): Set<WzImageProperty> | null {
    return null
  }

  public abstract get propertyType (): WzPropertyType

  /**
   * @virtual
   */
  public getFromPath (_path: string): WzImageProperty | null {
    return null
  }

  /**
   * @virtual
   */
  public at (_name: string): WzImageProperty | null {
    return null
  }

  /**
   * @virtual
   */
  public set (_name: string, _value: WzImageProperty): void {
    throw new NotImplementedError('[WzImageProperty#set]')
  }

  public get objectType (): WzObjectType {
    return WzObjectType.Property
  }

  public get parentImage (): WzImage | null {
    let parent = this.parent
    while (parent != null) {
      if (parent instanceof WzImage) return parent
      else parent = parent.parent
    }
    return null
  }

  public get wzFileParent (): WzFile | null {
    if (this.parentImage != null) {
      return this.parentImage.wzFileParent
    }
    return null
  }

  public static async parseLuaProperty<P extends WzObject>(_offset: number, reader: WzBinaryReader, parent: P, _parentImg: WzImage): Promise<WzLuaProperty> {
    // 28 71 4F EF 1B 65 F9 1F A7 48 8D 11 73 E7 F0 27 55 09 DD 3C 07 32 D7 38 21 57 84 70 C1 79 9A 3F 49 F7 79 03 41 F4 9D B9 1B 5F CF 26 80 3D EC 25 5F 9C
    // [compressed int] [bytes]
    const length = await reader.readWzInt()
    const rawEncBytes = await reader.read(length)
    const WzLuaProperty = require('./properties/WzLuaProperty').WzLuaProperty as typeof import('./properties/WzLuaProperty').WzLuaProperty
    const lua = new WzLuaProperty('Script', rawEncBytes)
    lua.parent = parent
    return lua
  }

  public static async parsePropertyList<P extends WzObject>(offset: number, reader: WzBinaryReader, parent: P, parentImg: WzImage): Promise<Set<WzImageProperty>> {
    const entryCount = await reader.readWzInt()
    const properties = new Set<WzImageProperty>(/* entryCount */)
    for (let i = 0; i < entryCount; i++) {
      const name = await reader.readStringBlock(offset)
      const ptype = await reader.readUInt8()
      switch (ptype) {
        case 0: {
          const WzNullProperty = require('./properties/WzNullProperty').WzNullProperty as typeof import('./properties/WzNullProperty').WzNullProperty
          const p = new WzNullProperty(name)
          p.parent = parent
          properties.add(p)
          break
        }
        case 11:
        case 2: {
          const WzShortProperty = require('./properties/WzShortProperty').WzShortProperty as typeof import('./properties/WzShortProperty').WzShortProperty
          const p = new WzShortProperty(name, await reader.readInt16LE())
          p.parent = parent
          properties.add(p)
          break
        }
        case 3:
        case 19: {
          const WzIntProperty = require('./properties/WzIntProperty').WzIntProperty as typeof import('./properties/WzIntProperty').WzIntProperty
          const p = new WzIntProperty(name, await reader.readWzInt())
          p.parent = parent
          properties.add(p)
          break
        }
        case 20: {
          const WzLongProperty = require('./properties/WzLongProperty').WzLongProperty as typeof import('./properties/WzLongProperty').WzLongProperty
          const p = new WzLongProperty(name, await reader.readWzLong())
          p.parent = parent
          properties.add(p)
          break
        }
        case 4: {
          const WzFloatProperty = require('./properties/WzFloatProperty').WzFloatProperty as typeof import('./properties/WzFloatProperty').WzFloatProperty
          const type = await reader.readUInt8()
          let p: import('./properties/WzFloatProperty').WzFloatProperty
          if (type === 0x80) {
            p = new WzFloatProperty(name, await reader.readFloatLE())
            p.parent = parent
            properties.add(p)
          } else if (type === 0) {
            p = new WzFloatProperty(name, 0)
            p.parent = parent
            properties.add(p)
          }
          break
        }
        case 5: {
          const WzDoubleProperty = require('./properties/WzDoubleProperty').WzDoubleProperty as typeof import('./properties/WzDoubleProperty').WzDoubleProperty
          const p = new WzDoubleProperty(name, await reader.readDoubleLE())
          p.parent = parent
          properties.add(p)
          break
        }
        case 8: {
          const WzStringProperty = require('./properties/WzStringProperty').WzStringProperty as typeof import('./properties/WzStringProperty').WzStringProperty
          const p = new WzStringProperty(name, await reader.readStringBlock(offset))
          p.parent = parent
          properties.add(p)
          break
        }
        case 9: {
          const eob = (await reader.readUInt32LE()) + reader.pos
          const exProp = await WzImageProperty.parseExtendedProp(reader, offset, eob, name, parent, parentImg)
          properties.add(exProp)
          if (reader.pos !== eob) {
            reader.pos = eob
          }
          break
        }
        default:
          throw new Error(`Unknown property type at ParsePropertyList, ptype = ${ptype}`)
      }
    }
    return properties
  }

  public static async parseExtendedProp<P extends WzObject> (reader: WzBinaryReader, offset: number, endOfBlock: number, name: string, parent: P, imgParent: WzImage): Promise<WzExtended> {
    const type = await reader.readUInt8()
    switch (type) {
      case 0x01:
      case 0x1B:
        return await WzImageProperty.extractMore(reader, offset, endOfBlock, name, await reader.readWzStringAtOffset(offset + await reader.readInt32LE()), parent, imgParent)
      case 0x00:
      case 0x73:
        return await WzImageProperty.extractMore(reader, offset, endOfBlock, name, '', parent, imgParent)
      default:
        throw new Error('Invalid byte read at ParseExtendedProp')
    }
  }

  public static async extractMore<P extends WzObject> (reader: WzBinaryReader, offset: number, _eob: number, name: string, iname: string, parent: P, imgParent: WzImage): Promise<WzExtended> {
    if (iname === '') {
      iname = await reader.readWzString()
    }

    switch (iname) {
      case 'Property': {
        const WzSubProperty = require('./properties/WzSubProperty').WzSubProperty as typeof import('./properties/WzSubProperty').WzSubProperty
        const subProp = new WzSubProperty(name)
        subProp.parent = parent
        reader.pos += 2 // Reserved?
        subProp.addProperties(await WzImageProperty.parsePropertyList(offset, reader, subProp, imgParent))
        return subProp
      }
      case 'Canvas': {
        const WzCanvasProperty = require('./properties/WzCanvasProperty').WzCanvasProperty as typeof import('./properties/WzCanvasProperty').WzCanvasProperty
        const canvasProp = new WzCanvasProperty(name)
        canvasProp.parent = parent
        reader.pos++
        const b = await reader.readUInt8()
        if (b === 1) {
          reader.pos += 2
          canvasProp.addProperties(await WzImageProperty.parsePropertyList(offset, reader, canvasProp, imgParent))
        }
        const WzPngProperty = require('./properties/WzPngProperty').WzPngProperty as typeof import('./properties/WzPngProperty').WzPngProperty
        canvasProp.pngProperty = await WzPngProperty.create(reader/* , imgParent.parseEverything */)
        canvasProp.pngProperty.parent = canvasProp
        return canvasProp
      }
      case 'Shape2D#Vector2D': {
        const WzVectorProperty = require('./properties/WzVectorProperty').WzVectorProperty as typeof import('./properties/WzVectorProperty').WzVectorProperty
        const WzIntProperty = require('./properties/WzIntProperty').WzIntProperty as typeof import('./properties/WzIntProperty').WzIntProperty
        const vecProp = new WzVectorProperty(name)
        vecProp.parent = parent
        vecProp.x = new WzIntProperty('x', await reader.readWzInt())
        vecProp.x.parent = vecProp
        vecProp.y = new WzIntProperty('y', await reader.readWzInt())
        vecProp.y.parent = vecProp
        return vecProp
      }
      case 'Shape2D#Convex2D': {
        const WzConvexProperty = require('./properties/WzConvexProperty').WzConvexProperty as typeof import('./properties/WzConvexProperty').WzConvexProperty
        const convexProp = new WzConvexProperty(name)
        convexProp.parent = parent
        const convexEntryCount = await reader.readWzInt()
        // convexProp.wzProperties.capacity = convexEntryCount
        for (let i = 0; i < convexEntryCount; i++) {
          convexProp.addProperty(await WzImageProperty.parseExtendedProp(reader, offset, 0, name, convexProp, imgParent))
        }
        return convexProp
      }
      case 'Sound_DX8': {
        const WzBinaryProperty = require('./properties/WzBinaryProperty').WzBinaryProperty as typeof import('./properties/WzBinaryProperty').WzBinaryProperty
        const soundProp = await WzBinaryProperty.create(name, reader, imgParent.parseEverything)
        soundProp.parent = parent
        return soundProp
      }
      case 'UOL': {
        const WzUOLProperty = require('./properties/WzUOLProperty').WzUOLProperty as typeof import('./properties/WzUOLProperty').WzUOLProperty
        reader.pos++
        const t = await reader.readUInt8()
        switch (t) {
          case 0: {
            const p = new WzUOLProperty(name, await reader.readWzString())
            p.parent = parent
            return p
          }
          case 1: {
            const p = new WzUOLProperty(name, await reader.readWzStringAtOffset(offset + await reader.readInt32LE()))
            p.parent = parent
            return p
          }
        }
        throw new Error('Unsupported UOL type')
      }
      default:
        throw new Error('Unknown iname: ' + iname)
    }
  }
}
