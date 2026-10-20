/* eslint-disable */
/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
/** Types of columns supported by the API */
export type ColumnType =
  | 'auto_number'
  | 'board_relation'
  | 'button'
  | 'checkbox'
  | 'color_picker'
  | 'country'
  | 'creation_log'
  | 'date'
  | 'dependency'
  | 'direct_doc'
  | 'doc'
  | 'dropdown'
  | 'email'
  | 'file'
  | 'formula'
  | 'group'
  | 'hour'
  | 'integration'
  | 'item_assignees'
  | 'item_id'
  | 'last_updated'
  | 'link'
  | 'location'
  | 'long_text'
  | 'mirror'
  | 'name'
  | 'numbers'
  | 'people'
  | 'person'
  | 'phone'
  | 'progress'
  | 'rating'
  | 'status'
  | 'subtasks'
  | 'tags'
  | 'team'
  | 'text'
  | 'time_tracking'
  | 'timeline'
  | 'unsupported'
  | 'vote'
  | 'week'
  | 'world_clock';

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { me: { id: string, name: string, account: { id: string, name: string, slug: string } } | null };

export type BoardsQueryVariables = Exact<{
  limit: number;
  page: number;
}>;


export type BoardsQuery = { boards: Array<{ id: string, name: string, workspace: { name: string } | null, groups: Array<{ id: string, title: string } | null> | null, columns: Array<{ id: string, title: string, type: ColumnType } | null> | null } | null> | null };

export type BoardQueryVariables = Exact<{
  id: string;
}>;


export type BoardQuery = { boards: Array<{ id: string, name: string, groups: Array<{ id: string, title: string } | null> | null, columns: Array<{ id: string, title: string, type: ColumnType } | null> | null } | null> | null };

export type CreateItemMutationVariables = Exact<{
  boardId: string;
  groupId?: string | null | undefined;
  name: string;
  columnValues?: unknown;
}>;


export type CreateItemMutation = { create_item: { id: string, name: string, url: string } | null };

export type CreateUpdateMutationVariables = Exact<{
  itemId: string;
  body: string;
}>;


export type CreateUpdateMutation = { create_update: { id: string } | null };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}

export const MeDocument = new TypedDocumentString(`
    query Me {
  me {
    id
    name
    account {
      id
      name
      slug
    }
  }
}
    `) as unknown as TypedDocumentString<MeQuery, MeQueryVariables>;
export const BoardsDocument = new TypedDocumentString(`
    query Boards($limit: Int!, $page: Int!) {
  boards(limit: $limit, page: $page, state: active, order_by: used_at) {
    id
    name
    workspace {
      name
    }
    groups {
      id
      title
    }
    columns {
      id
      title
      type
    }
  }
}
    `) as unknown as TypedDocumentString<BoardsQuery, BoardsQueryVariables>;
export const BoardDocument = new TypedDocumentString(`
    query Board($id: ID!) {
  boards(ids: [$id]) {
    id
    name
    groups {
      id
      title
    }
    columns {
      id
      title
      type
    }
  }
}
    `) as unknown as TypedDocumentString<BoardQuery, BoardQueryVariables>;
export const CreateItemDocument = new TypedDocumentString(`
    mutation CreateItem($boardId: ID!, $groupId: String, $name: String!, $columnValues: JSON) {
  create_item(
    board_id: $boardId
    group_id: $groupId
    item_name: $name
    column_values: $columnValues
    create_labels_if_missing: true
  ) {
    id
    name
    url
  }
}
    `) as unknown as TypedDocumentString<CreateItemMutation, CreateItemMutationVariables>;
export const CreateUpdateDocument = new TypedDocumentString(`
    mutation CreateUpdate($itemId: ID!, $body: String!) {
  create_update(item_id: $itemId, body: $body) {
    id
  }
}
    `) as unknown as TypedDocumentString<CreateUpdateMutation, CreateUpdateMutationVariables>;