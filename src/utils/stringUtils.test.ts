/**
 * StringUtils 测试
 */
import { describe, it, expect } from 'vitest'
import { toPascalCase, toCamelCase, toKebabCase } from './stringUtils'

describe('toPascalCase', () => {
  it('应该转换简单字符串', () => {
    expect(toPascalCase('hello world')).toBe('HelloWorld')
  })

  it('应该处理多分隔符', () => {
    expect(toPascalCase('hello-world_test')).toBe('HelloWorldTest')
  })

  it('应该处理已是大写的字符串', () => {
    expect(toPascalCase('HelloWorld')).toBe('HelloWorld')
  })

  it('应该处理空字符串', () => {
    expect(toPascalCase('')).toBe('')
  })

  it('应该处理数字', () => {
    expect(toPascalCase('card 123')).toBe('Card123')
  })
})

describe('toCamelCase', () => {
  it('应该转换为首字母小写', () => {
    expect(toCamelCase('hello world')).toBe('helloWorld')
  })

  it('空字符串应返回空字符串', () => {
    expect(toCamelCase('')).toBe('')
  })
})

describe('toKebabCase', () => {
  it('应该转换为短横线连接', () => {
    expect(toKebabCase('HelloWorld')).toBe('hello-world')
  })

  it('应该处理已经是camelCase的字符串', () => {
    expect(toKebabCase('helloWorldTest')).toBe('hello-world-test')
  })

  it('应该处理下划线', () => {
    expect(toKebabCase('hello_world')).toBe('hello-world')
  })
})