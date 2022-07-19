/**
 * @fileoverview Interactions should be awaited
 * @author Yann Braga
 */

import type { ImportDeclaration, CallExpression, Identifier, Node } from '@typescript-eslint/types/dist/ast-spec'

import { createStorybookRule } from '../utils/create-storybook-rule'
import { CategoryId } from '../utils/constants'
import {
  isMemberExpression,
  isIdentifier,
  isAwaitExpression,
  isCallExpression,
  isArrowFunctionExpression,
  isReturnStatement,
  isTSNonNullExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isProgram,
} from '../utils/ast'
import { ReportFixFunction } from '@typescript-eslint/experimental-utils/dist/ts-eslint'

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

export = createStorybookRule({
  name: 'await-interactions',
  defaultOptions: [],
  meta: {
    docs: {
      description: 'Interactions should be awaited',
      categories: [CategoryId.ADDON_INTERACTIONS, CategoryId.RECOMMENDED],
      recommended: 'error', // or 'warn'
    },
    messages: {
      interactionShouldBeAwaited: 'Interaction should be awaited: {{method}}',
      fixSuggestion: 'Add `await` to method',
    },
    type: 'problem',
    fixable: 'code',
    hasSuggestions: true,
    schema: [],
  },

  create(context) {
    // variables should be defined here

    //----------------------------------------------------------------------
    // Helpers
    //----------------------------------------------------------------------

    // any helper functions should go here or else delete this section

    const FUNCTIONS_TO_BE_AWAITED = [
      'waitFor',
      'waitForElementToBeRemoved',
      'wait',
      'waitForElement',
      'waitForDomChange',
      'userEvent',
      'play',
    ]

    const getMethodThatShouldBeAwaited = (expr: CallExpression) => {
      const shouldAwait = (name: string) => {
        return FUNCTIONS_TO_BE_AWAITED.includes(name) || name.startsWith('findBy')
      }

      // When an expression is a return value it doesn't need to be awaited
      if (isArrowFunctionExpression(expr.parent) || isReturnStatement(expr.parent)) {
        return null
      }

      if (
        isMemberExpression(expr.callee) &&
        isIdentifier(expr.callee.object) &&
        shouldAwait(expr.callee.object.name)
      ) {
        return expr.callee.object
      }

      if (
        isTSNonNullExpression(expr.callee) &&
        isMemberExpression(expr.callee.expression) &&
        isIdentifier(expr.callee.expression.property) &&
        shouldAwait(expr.callee.expression.property.name)
      ) {
        return expr.callee.expression.property
      }

      if (
        isMemberExpression(expr.callee) &&
        isIdentifier(expr.callee.property) &&
        shouldAwait(expr.callee.property.name)
      ) {
        return expr.callee.property
      }

      if (
        isMemberExpression(expr.callee) &&
        isCallExpression(expr.callee.object) &&
        isIdentifier(expr.callee.object.callee) &&
        isIdentifier(expr.callee.property) &&
        expr.callee.object.callee.name === 'expect'
      ) {
        return expr.callee.property
      }

      if (isIdentifier(expr.callee) && shouldAwait(expr.callee.name)) {
        return expr.callee
      }

      return null
    }

    const getClosestFunctionAncestor = (node: Node): Node | undefined => {
      const parent = node.parent

      if (!parent || isProgram(parent)) return undefined
      if (
        isArrowFunctionExpression(parent) ||
        isFunctionExpression(parent) ||
        isFunctionDeclaration(parent)
      ) {
        return node.parent
      }

      return getClosestFunctionAncestor(parent)
    }

    const isExpectFromStorybookImported = (node: ImportDeclaration) => {
      return (
        node.source.value.startsWith('@storybook/')
      )
    }

    //----------------------------------------------------------------------
    // Public
    //----------------------------------------------------------------------
    /**
     * @param {import('eslint').Rule.Node} node
     */

    let isImportingFromStorybookExpect = true
    let invocationsThatShouldBeAwaited = [] as Array<{ node: Node; method: Identifier }>

    return {
      ImportDeclaration(node) {
        if (!isExpectFromStorybookImported(node)) {
          isImportingFromStorybookExpect = false
        }
      },
      CallExpression(node: CallExpression) {
        const method = getMethodThatShouldBeAwaited(node)
        if (method && !isAwaitExpression(node.parent) && !isAwaitExpression(node.parent?.parent)) {
          invocationsThatShouldBeAwaited.push({ node, method })
        }
      },
      'Program:exit': function () {
        if (isImportingFromStorybookExpect && invocationsThatShouldBeAwaited.length) {
          invocationsThatShouldBeAwaited.forEach(({ node, method }) => {
            const parentFnNode = getClosestFunctionAncestor(node)
            const parentFnNeedsAsync =
              parentFnNode && !('async' in parentFnNode && parentFnNode.async)

            const fixFn: ReportFixFunction = (fixer) => {
              const fixerResult = [fixer.insertTextBefore(node, 'await ')]

              if (parentFnNeedsAsync) {
                fixerResult.push(fixer.insertTextBefore(parentFnNode, 'async '))
              }
              return fixerResult
            }

            context.report({
              node,
              messageId: 'interactionShouldBeAwaited',
              data: {
                method: method.name,
              },
              fix: fixFn,
              suggest: [
                {
                  messageId: 'fixSuggestion',
                  fix: fixFn,
                },
              ],
            })
          })
        }
      },
    }
  },
})
