/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  query Me {\n    me {\n      id\n      name\n      account {\n        id\n        name\n        slug\n      }\n    }\n  }\n": typeof types.MeDocument,
    "\n  query Boards($limit: Int!, $page: Int!) {\n    boards(limit: $limit, page: $page, state: active, order_by: used_at) {\n      id\n      name\n      workspace {\n        name\n      }\n      groups {\n        id\n        title\n      }\n      columns {\n        id\n        title\n        type\n      }\n    }\n  }\n": typeof types.BoardsDocument,
    "\n  query Board($id: ID!) {\n    boards(ids: [$id]) {\n      id\n      name\n      groups {\n        id\n        title\n      }\n      columns {\n        id\n        title\n        type\n      }\n    }\n  }\n": typeof types.BoardDocument,
    "\n  mutation CreateItem($boardId: ID!, $groupId: String, $name: String!, $columnValues: JSON) {\n    create_item(\n      board_id: $boardId\n      group_id: $groupId\n      item_name: $name\n      column_values: $columnValues\n      create_labels_if_missing: true\n    ) {\n      id\n      name\n      url\n    }\n  }\n": typeof types.CreateItemDocument,
    "\n  mutation CreateUpdate($itemId: ID!, $body: String!) {\n    create_update(item_id: $itemId, body: $body) {\n      id\n    }\n  }\n": typeof types.CreateUpdateDocument,
};
const documents: Documents = {
    "\n  query Me {\n    me {\n      id\n      name\n      account {\n        id\n        name\n        slug\n      }\n    }\n  }\n": types.MeDocument,
    "\n  query Boards($limit: Int!, $page: Int!) {\n    boards(limit: $limit, page: $page, state: active, order_by: used_at) {\n      id\n      name\n      workspace {\n        name\n      }\n      groups {\n        id\n        title\n      }\n      columns {\n        id\n        title\n        type\n      }\n    }\n  }\n": types.BoardsDocument,
    "\n  query Board($id: ID!) {\n    boards(ids: [$id]) {\n      id\n      name\n      groups {\n        id\n        title\n      }\n      columns {\n        id\n        title\n        type\n      }\n    }\n  }\n": types.BoardDocument,
    "\n  mutation CreateItem($boardId: ID!, $groupId: String, $name: String!, $columnValues: JSON) {\n    create_item(\n      board_id: $boardId\n      group_id: $groupId\n      item_name: $name\n      column_values: $columnValues\n      create_labels_if_missing: true\n    ) {\n      id\n      name\n      url\n    }\n  }\n": types.CreateItemDocument,
    "\n  mutation CreateUpdate($itemId: ID!, $body: String!) {\n    create_update(item_id: $itemId, body: $body) {\n      id\n    }\n  }\n": types.CreateUpdateDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Me {\n    me {\n      id\n      name\n      account {\n        id\n        name\n        slug\n      }\n    }\n  }\n"): typeof import('./graphql').MeDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Boards($limit: Int!, $page: Int!) {\n    boards(limit: $limit, page: $page, state: active, order_by: used_at) {\n      id\n      name\n      workspace {\n        name\n      }\n      groups {\n        id\n        title\n      }\n      columns {\n        id\n        title\n        type\n      }\n    }\n  }\n"): typeof import('./graphql').BoardsDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query Board($id: ID!) {\n    boards(ids: [$id]) {\n      id\n      name\n      groups {\n        id\n        title\n      }\n      columns {\n        id\n        title\n        type\n      }\n    }\n  }\n"): typeof import('./graphql').BoardDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateItem($boardId: ID!, $groupId: String, $name: String!, $columnValues: JSON) {\n    create_item(\n      board_id: $boardId\n      group_id: $groupId\n      item_name: $name\n      column_values: $columnValues\n      create_labels_if_missing: true\n    ) {\n      id\n      name\n      url\n    }\n  }\n"): typeof import('./graphql').CreateItemDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateUpdate($itemId: ID!, $body: String!) {\n    create_update(item_id: $itemId, body: $body) {\n      id\n    }\n  }\n"): typeof import('./graphql').CreateUpdateDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
